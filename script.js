// ==================== CONFIGURATION ====================
const CONFIG = {
    // Set forecast start time to IST (Indian Standard Time)
    forecastStart: new Date("2026-02-08T05:30:00+05:30"),
    baseFrameTime: 1000,
    debugMode: true,
    
    // WRF Domain bounds for Uttarakhand (Southwest to Northeast)
    wrfBounds: [
        [28.3241, 77.3086], // SW corner (Lat, Lon) - BOTTOM-LEFT
        [31.7777, 81.2995]  // NE corner (Lat, Lon) - TOP-RIGHT
    ],
    
    // Map view bounds (slightly larger for navigation - SW to NE)
    mapViewBounds: [
        [27.0, 76.0], // SW corner - SMALLER lat, SMALLER lon (southwest of domain)
        [32.5, 82.5]  // NE corner - LARGER lat, LARGER lon (northeast of domain)
    ],
    
    variables: {
        T2: { name: "2m Temperature", unit: "°C", precision: 1 },
        RH: { name: "Relative Humidity", unit: "%", precision: 0 },
        WIND: { name: "Wind Speed", unit: "m/s", precision: 1 },
        RAIN: { name: "Hourly Rainfall", unit: "mm", precision: 2 }
    }
};

// ==================== APPLICATION STATE ====================
const state = {
    currentLayer: null,
    currentGrid: null,
    currentFH: 0,
    allGrids: {},
    totalForecastHours: 239, // Will be detected dynamically
    isPlaying: false,
    timer: null,
    currentSpeed: 1.0,
    isDataLoaded: false,
    lastClickPos: null,
    map: null,
    baseLayer: null,
    markers: {
        clickMarker: null,
        boundaryLayer: null
    },
    currentTheme: 'light',
    // Timeseries state
    timeseriesData: {
        lat: null,
        lon: null,
        gridI: null,
        gridJ: null,
        variable: null,
        values: [],
        hours: [],
        timestamps: []
    },
    chartInstance: null,
    isLoadingTimeseries: false
};

// ==================== UI ELEMENTS ====================
const elements = {
    slider: document.getElementById("timeSlider"),
    timeLabel: document.getElementById("timeLabel"),
    varSelect: document.getElementById("varSelect"),
    playBtn: document.getElementById("playBtn"),
    speedSelect: document.getElementById("speedSelect"),
    nextBtn: document.getElementById("nextBtn"),
    prevBtn: document.getElementById("prevBtn"),
    fcStart: document.getElementById("fcStart"),
    fcValid: document.getElementById("fcValid"),
    currentFH: document.getElementById("currentFH"),
    totalFH: document.getElementById("totalFH"),
    variableName: document.getElementById("variableName"),
    variableIcon: document.getElementById("variableIcon"),
    cbar: document.getElementById("cbar"),
    lat: document.getElementById("lat"),
    lon: document.getElementById("lon"),
    varValue: document.getElementById("varValue"),
    gridInfo: document.getElementById("gridInfo"),
    status: document.getElementById("status"),
    statusIcon: document.getElementById("statusIcon"),
    themeToggle: document.getElementById("themeToggle"),
    // Chart elements
    chartModal: document.getElementById("chartModal"),
    chartTitle: document.getElementById("chartTitle"),
    chartSubtitle: document.getElementById("chartSubtitle"),
    chartStats: document.getElementById("chartStats"),
    timeseriesChart: document.getElementById("timeseriesChart"),
    downloadCSVBtn: document.getElementById("downloadCSVBtn"),
    exportChartBtn: document.getElementById("exportChartBtn"),
    closeChartBtn: document.getElementById("closeChartBtn"),
    chartModalClose: document.querySelector('.chart-modal-close'),
    chartLoading: document.getElementById("chartLoading"),
    loadingText: document.getElementById("loadingText"),
    progressFill: document.getElementById("progressFill")
};

// ==================== UTILITY FUNCTIONS ====================
function debug(message, data = null) {
    if (CONFIG.debugMode) {
        console.log(`🔍 ${message}`, data || '');
    }
}

function updateStatus(message, type = 'info') {
    const colors = {
        error: '#f56565',
        warn: '#ed8936',
        info: '#4299e1',
        success: '#48bb78'
    };
    
    const icon = colors[type] || colors.info;
    elements.status.textContent = message;
    elements.statusIcon.style.color = icon;
}

// ==================== DETECT TOTAL FORECAST HOURS ====================
async function detectTotalForecastHours() {
    try {
        // Try to detect from slider first
        const maxSlider = parseInt(elements.slider.max);
        if (maxSlider > 0) {
            state.totalForecastHours = maxSlider;
            elements.totalFH.textContent = state.totalForecastHours;
            debug(`Using slider max: ${state.totalForecastHours} hours`);
            return state.totalForecastHours;
        }
        
        // Try to detect by checking for available data files
        const variable = elements.varSelect.value;
        let foundHours = 0;
        
        // Check for hours 0-500 (reasonable maximum)
        updateStatus('Detecting forecast hours...', 'info');
        
        // Check a few specific hours first to get an estimate
        const checkPoints = [0, 24, 48, 72, 96, 120, 168, 240, 336, 500];
        
        for (const hour of checkPoints) {
            try {
                const paddedFH = hour.toString().padStart(3, '0');
                const response = await fetch(`data_json/${variable}/${variable}_${paddedFH}.json`, { method: 'HEAD' });
                if (response.ok) {
                    foundHours = hour;
                    debug(`Found data at hour ${hour}`);
                }
            } catch (error) {
                break;
            }
        }
        
        if (foundHours > 0) {
            // Do a binary search to find the exact maximum
            let low = foundHours;
            let high = Math.min(foundHours * 2, 500);
            let lastFound = foundHours;
            
            while (low <= high) {
                const mid = Math.floor((low + high) / 2);
                try {
                    const paddedFH = mid.toString().padStart(3, '0');
                    const response = await fetch(`data_json/${variable}/${variable}_${paddedFH}.json`, { method: 'HEAD' });
                    if (response.ok) {
                        lastFound = mid;
                        low = mid + 1;
                    } else {
                        high = mid - 1;
                    }
                } catch (error) {
                    high = mid - 1;
                }
            }
            
            state.totalForecastHours = lastFound;
            elements.slider.max = lastFound;
            elements.totalFH.textContent = lastFound;
            debug(`Detected ${lastFound} forecast hours`);
            updateStatus(`Detected ${lastFound} forecast hours`, 'success');
            return lastFound;
        }
        
        // Default to 239 if detection fails
        state.totalForecastHours = 239;
        elements.totalFH.textContent = '239';
        debug('Using default: 239 hours');
        return 239;
        
    } catch (error) {
        debug('Error detecting forecast hours:', error);
        state.totalForecastHours = 239;
        elements.totalFH.textContent = '239';
        return 239;
    }
}

// ==================== THEME MANAGEMENT ====================
function setupThemeToggle() {
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    const savedTheme = localStorage.getItem('wrfTheme') || 'light';
    
    document.body.setAttribute('data-theme', savedTheme);
    state.currentTheme = savedTheme;
    updateThemeIcon(savedTheme);
    
    initializeBasemap(savedTheme);
    
    elements.themeToggle.addEventListener('click', () => {
        const currentTheme = document.body.getAttribute('data-theme');
        const newTheme = currentTheme === 'dark' ? 'light' : 'dark';
        
        document.body.setAttribute('data-theme', newTheme);
        localStorage.setItem('wrfTheme', newTheme);
        state.currentTheme = newTheme;
        updateThemeIcon(newTheme);
        updateBaseMapTheme(newTheme);
        
        debug(`Theme changed to ${newTheme}`);
        updateStatus(`Switched to ${newTheme} theme`, 'info');
        
        // Update chart theme if it exists
        if (state.chartInstance) {
            updateChartTheme();
        }
    });
    
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', (e) => {
        if (!localStorage.getItem('wrfTheme')) {
            const newTheme = e.matches ? 'dark' : 'light';
            document.body.setAttribute('data-theme', newTheme);
            state.currentTheme = newTheme;
            updateThemeIcon(newTheme);
            updateBaseMapTheme(newTheme);
            debug(`System theme changed to ${newTheme}`);
        }
    });
}

function updateThemeIcon(theme) {
    const icon = elements.themeToggle.querySelector('i');
    if (theme === 'dark') {
        icon.className = 'fas fa-moon';
        icon.title = 'Switch to Light Mode';
    } else {
        icon.className = 'fas fa-sun';
        icon.title = 'Switch to Dark Mode';
    }
}

// ==================== FORMAT IST TIME ====================
function formatISTTime(date) {
    const options = {
        timeZone: 'Asia/Kolkata',
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false
    };
    
    let formatted = date.toLocaleString('en-IN', options);
    return formatted.replace(',', '').replace(' AM', '').replace(' PM', '') + ' IST';
}

// ==================== UPDATE TIME DISPLAY ====================
function updateTimeDisplay(fh) {
    elements.timeLabel.textContent = `+${fh} h`;
    elements.currentFH.textContent = fh;
    
    const forecastStart = CONFIG.forecastStart;
    const validTime = new Date(forecastStart.getTime() + fh * 3600 * 1000);
    
    elements.fcStart.textContent = formatISTTime(forecastStart);
    elements.fcValid.textContent = formatISTTime(validTime);
}

// ==================== TIMESERIES FUNCTIONS ====================
async function fetchTimeseriesData(lat, lon, variable, gridI, gridJ) {
    state.isLoadingTimeseries = true;
    showLoadingOverlay(true);
    
    try {
        updateStatus(`Loading timeseries data for ${variable}...`, 'info');
        
        const timeseriesValues = [];
        const hours = [];
        const timestamps = [];
        
        // Determine how many hours to load
        const totalHours = state.totalForecastHours;
        let loadedCount = 0;
        
        // Load data for all forecast hours
        for (let fh = 0; fh <= totalHours; fh++) {
            // Update progress
            const progress = Math.round((fh / totalHours) * 100);
            elements.progressFill.style.width = `${progress}%`;
            elements.loadingText.textContent = `Loading hour ${fh}/${totalHours}...`;
            
            // Small delay to prevent UI blocking
            if (fh % 10 === 0) {
                await new Promise(resolve => setTimeout(resolve, 1));
            }
            
            const cacheKey = `${variable}_${fh}`;
            
            // Check if we have this grid cached
            if (!state.allGrids[cacheKey]) {
                // Try to load the grid data
                try {
                    const paddedFH = fh.toString().padStart(3, '0');
                    const response = await fetch(`data_json/${variable}/${variable}_${paddedFH}.json`);
                    if (!response.ok) {
                        // Try alternative naming convention
                        const response2 = await fetch(`data_json/${variable}/${variable}_${fh}.json`);
                        if (!response2.ok) continue;
                        
                        const gridData = await response2.json();
                        state.allGrids[cacheKey] = gridData;
                    } else {
                        const gridData = await response.json();
                        state.allGrids[cacheKey] = gridData;
                    }
                } catch (error) {
                    continue; // Skip this hour if data not available
                }
            }
            
            const gridData = state.allGrids[cacheKey];
            
            // Get value at the grid coordinates
            if (gridData && gridData.values && 
                gridI < gridData.values.length && 
                gridJ < gridData.values[0].length) {
                
                const value = gridData.values[gridI][gridJ];
                
                if (value !== null && value !== undefined && !isNaN(value)) {
                    timeseriesValues.push(value);
                    hours.push(fh);
                    
                    const timestamp = new Date(CONFIG.forecastStart.getTime() + fh * 3600 * 1000);
                    timestamps.push(timestamp);
                    loadedCount++;
                }
            }
        }
        
        // Store timeseries data
        state.timeseriesData = {
            lat: lat,
            lon: lon,
            gridI: gridI,
            gridJ: gridJ,
            variable: variable,
            values: timeseriesValues,
            hours: hours,
            timestamps: timestamps
        };
        
        updateStatus(`Timeseries data loaded (${timeseriesValues.length} points)`, 'success');
        return true;
        
    } catch (error) {
        debug(`Failed to load timeseries data: ${error.message}`, error);
        updateStatus(`Error loading timeseries data: ${error.message}`, 'error');
        return false;
    } finally {
        state.isLoadingTimeseries = false;
        showLoadingOverlay(false);
    }
}

function showLoadingOverlay(show) {
    if (show) {
        elements.chartLoading.style.display = 'flex';
        elements.progressFill.style.width = '0%';
    } else {
        elements.chartLoading.style.display = 'none';
    }
}

async function showTimeseriesChart(lat, lon, variable, gridI, gridJ) {
    // Show modal immediately
    elements.chartModal.style.display = 'block';
    elements.chartTitle.textContent = `${CONFIG.variables[variable].name} Timeseries`;
    elements.chartSubtitle.textContent = `Loading data for (${lat.toFixed(4)}°, ${lon.toFixed(4)}°)...`;
    
    // Clear previous chart
    if (state.chartInstance) {
        state.chartInstance.destroy();
        state.chartInstance = null;
    }
    
    // Clear previous stats
    elements.chartStats.innerHTML = `
        <div class="stat-item">
            <div class="stat-label"><i class="fas fa-spinner fa-spin"></i> Loading Data</div>
            <div class="stat-value">Please wait...</div>
            <div class="stat-subvalue">Loading ${state.totalForecastHours} forecast hours</div>
        </div>
    `;
    
    // Disable download buttons while loading
    elements.downloadCSVBtn.disabled = true;
    elements.exportChartBtn.disabled = true;
    
    // Fetch data
    const success = await fetchTimeseriesData(lat, lon, variable, gridI, gridJ);
    
    // Re-enable buttons
    elements.downloadCSVBtn.disabled = false;
    elements.exportChartBtn.disabled = false;
    
    if (!success || state.timeseriesData.values.length === 0) {
        elements.chartSubtitle.textContent = `No data available at (${lat.toFixed(4)}°, ${lon.toFixed(4)}°)`;
        elements.chartStats.innerHTML = `
            <div class="stat-item">
                <div class="stat-label"><i class="fas fa-exclamation-triangle"></i> No Data Available</div>
                <div class="stat-value">--</div>
                <div class="stat-subvalue">Could not load timeseries data</div>
            </div>
        `;
        return;
    }
    
    // Update UI with loaded data
    updateChartUI();
    createBeautifulChart();
}

function updateChartUI() {
    const data = state.timeseriesData;
    const varConfig = CONFIG.variables[data.variable];
    
    // Update titles
    elements.chartTitle.textContent = `${varConfig.name} Timeseries`;
    elements.chartSubtitle.textContent = `Location: ${data.lat.toFixed(4)}°N, ${data.lon.toFixed(4)}°E | Grid: [${data.gridI}, ${data.gridJ}] | ${data.values.length} data points`;
    
    // Update statistics
    updateChartStats(data);
}

function updateChartStats(data) {
    const varConfig = CONFIG.variables[data.variable];
    
    if (data.values.length === 0) {
        elements.chartStats.innerHTML = `
            <div class="stat-item">
                <div class="stat-label"><i class="fas fa-exclamation-triangle"></i> No Data</div>
                <div class="stat-value">--</div>
                <div class="stat-subvalue">No data points available</div>
            </div>
        `;
        return;
    }
    
    // Calculate statistics
    const min = Math.min(...data.values);
    const max = Math.max(...data.values);
    const sum = data.values.reduce((a, b) => a + b, 0);
    const avg = sum / data.values.length;
    
    // Calculate variance and standard deviation
    const variance = data.values.reduce((acc, val) => acc + Math.pow(val - avg, 2), 0) / data.values.length;
    const stdDev = Math.sqrt(variance);
    
    // Find timestamps for min and max
    const minIndex = data.values.indexOf(min);
    const maxIndex = data.values.indexOf(max);
    const minTime = data.timestamps[minIndex];
    const maxTime = data.timestamps[maxIndex];
    
    // Calculate range
    const range = max - min;
    
    // Calculate trends (simple linear regression)
    let sumX = 0, sumY = 0, sumXY = 0, sumX2 = 0;
    const n = data.values.length;
    
    for (let i = 0; i < n; i++) {
        sumX += i;
        sumY += data.values[i];
        sumXY += i * data.values[i];
        sumX2 += i * i;
    }
    
    const slope = (n * sumXY - sumX * sumY) / (n * sumX2 - sumX * sumX);
    const trend = slope > 0 ? 'Increasing' : slope < 0 ? 'Decreasing' : 'Stable';
    const trendValue = Math.abs(slope * n).toFixed(varConfig.precision);
    
    // Format times
    const formatTime = (date) => {
        return date.toLocaleString('en-IN', {
            timeZone: 'Asia/Kolkata',
            hour: '2-digit',
            minute: '2-digit',
            hour12: false
        }) + ' IST';
    };
    
    elements.chartStats.innerHTML = `
        <div class="stat-item">
            <div class="stat-label"><i class="fas fa-thermometer-empty"></i> Minimum</div>
            <div class="stat-value">${min.toFixed(varConfig.precision)} ${varConfig.unit}</div>
            <div class="stat-subvalue">at ${formatTime(minTime)}</div>
        </div>
        <div class="stat-item">
            <div class="stat-label"><i class="fas fa-thermometer-full"></i> Maximum</div>
            <div class="stat-value">${max.toFixed(varConfig.precision)} ${varConfig.unit}</div>
            <div class="stat-subvalue">at ${formatTime(maxTime)}</div>
        </div>
        <div class="stat-item">
            <div class="stat-label"><i class="fas fa-calculator"></i> Average</div>
            <div class="stat-value">${avg.toFixed(varConfig.precision)} ${varConfig.unit}</div>
            <div class="stat-subvalue">Range: ${range.toFixed(varConfig.precision)}</div>
        </div>
        <div class="stat-item">
            <div class="stat-label"><i class="fas fa-chart-line"></i> Statistics</div>
            <div class="stat-value">${data.values.length} points</div>
            <div class="stat-subvalue">Trend: ${trend} </div>
        </div>
    `;
}

function createBeautifulChart() {
    const data = state.timeseriesData;
    const varConfig = CONFIG.variables[data.variable];
    const ctx = elements.timeseriesChart.getContext('2d');
    
    // Destroy existing chart
    if (state.chartInstance) {
        state.chartInstance.destroy();
    }
    
    // Format timestamps for x-axis (optimized for display)
    const formattedTimes = data.timestamps.map((ts, index) => {
        // Show fewer labels for better readability
        if (data.timestamps.length > 50 && index % Math.ceil(data.timestamps.length / 20) !== 0) {
            return '';
        }
        
        return ts.toLocaleString('en-IN', {
            timeZone: 'Asia/Kolkata',
            month: 'short',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
            hour12: false
        });
    });
    
    // Create gradient based on theme
    const gradient = ctx.createLinearGradient(0, 0, 0, 400);
    if (state.currentTheme === 'dark') {
        gradient.addColorStop(0, 'rgba(99, 179, 237, 0.8)');
        gradient.addColorStop(0.5, 'rgba(99, 179, 237, 0.3)');
        gradient.addColorStop(1, 'rgba(99, 179, 237, 0.05)');
    } else {
        gradient.addColorStop(0, 'rgba(49, 130, 206, 0.8)');
        gradient.addColorStop(0.5, 'rgba(49, 130, 206, 0.3)');
        gradient.addColorStop(1, 'rgba(49, 130, 206, 0.05)');
    }
    
    // Define colors based on theme
    const gridColor = state.currentTheme === 'dark' ? 'rgba(74, 85, 104, 0.3)' : 'rgba(203, 213, 224, 0.5)';
    const textColor = state.currentTheme === 'dark' ? '#a0aec0' : '#4a5568';
    const backgroundColor = state.currentTheme === 'dark' ? 'rgba(26, 32, 44, 0.95)' : 'rgba(255, 255, 255, 0.95)';
    const borderColor = state.currentTheme === 'dark' ? '#63b3ed' : '#3182ce';
    
    // Create beautiful chart
    state.chartInstance = new Chart(ctx, {
        type: 'line',
        data: {
            labels: formattedTimes,
            datasets: [{
                label: `${varConfig.name} (${varConfig.unit})`,
                data: data.values,
                borderColor: borderColor,
                backgroundColor: gradient,
                borderWidth: 3,
                pointRadius: data.values.length > 100 ? 2 : 4,
                pointBackgroundColor: borderColor,
                pointBorderColor: '#ffffff',
                pointBorderWidth: 1,
                pointHoverRadius: 6,
                pointHoverBackgroundColor: '#ffffff',
                pointHoverBorderColor: borderColor,
                pointHoverBorderWidth: 2,
                fill: true,
                tension: 0.2,
                cubicInterpolationMode: 'monotone'
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: {
                    labels: {
                        color: textColor,
                        font: {
                            size: 14,
                            family: "'Segoe UI', 'Roboto', sans-serif",
                            weight: '600'
                        },
                        padding: 20,
                        usePointStyle: true,
                        pointStyle: 'circle'
                    },
                    position: 'top',
                    align: 'end'
                },
                tooltip: {
                    mode: 'index',
                    intersect: false,
                    backgroundColor: backgroundColor,
                    titleColor: textColor,
                    bodyColor: textColor,
                    borderColor: borderColor,
                    borderWidth: 1,
                    cornerRadius: 8,
                    padding: 12,
                    boxPadding: 6,
                    titleFont: {
                        size: 13,
                        weight: '600'
                    },
                    bodyFont: {
                        size: 13
                    },
                    callbacks: {
                        title: function(tooltipItems) {
                            const date = data.timestamps[tooltipItems[0].dataIndex];
                            return date.toLocaleString('en-IN', {
                                timeZone: 'Asia/Kolkata',
                                weekday: 'short',
                                year: 'numeric',
                                month: 'short',
                                day: 'numeric',
                                hour: '2-digit',
                                minute: '2-digit',
                                hour12: false
                            }) + ' IST';
                        },
                        label: function(context) {
                            return `${varConfig.name}: ${context.parsed.y.toFixed(varConfig.precision)} ${varConfig.unit}`;
                        },
                        afterLabel: function(context) {
                            return `Forecast Hour: ${data.hours[context.dataIndex]}`;
                        }
                    }
                },
                zoom: {
                    pan: {
                        enabled: true,
                        mode: 'xy',
                        modifierKey: 'ctrl'
                    },
                    zoom: {
                        wheel: {
                            enabled: true,
                            speed: 0.1
                        },
                        pinch: {
                            enabled: true
                        },
                        mode: 'xy',
                        drag: {
                            enabled: true,
                            borderColor: 'rgba(225,225,225,0.3)',
                            borderWidth: 1,
                            backgroundColor: 'rgba(225,225,225,0.3)'
                        }
                    },
                    limits: {
                        x: { min: 'original', max: 'original' },
                        y: { min: 'original', max: 'original' }
                    }
                }
            },
            scales: {
                x: {
                    grid: {
                        color: gridColor,
                        drawBorder: false,
                        drawTicks: false
                    },
                    ticks: {
                        color: textColor,
                        maxRotation: 45,
                        minRotation: 45,
                        font: {
                            size: 11
                        },
                        maxTicksLimit: 15,
                        autoSkip: true,
                        autoSkipPadding: 20
                    },
                    title: {
                        display: true,
                        text: 'Date Time (IST)',
                        color: textColor,
                        font: {
                            size: 13,
                            weight: '600'
                        },
                        padding: { top: 15, bottom: 5 }
                    }
                },
                y: {
                    grid: {
                        color: gridColor,
                        drawBorder: false
                    },
                    ticks: {
                        color: textColor,
                        font: {
                            size: 12
                        },
                        callback: function(value) {
                            return value.toFixed(varConfig.precision) + ' ' + varConfig.unit;
                        },
                        padding: 10
                    },
                    title: {
                        display: true,
                        text: `${varConfig.name} (${varConfig.unit})`,
                        color: textColor,
                        font: {
                            size: 13,
                            weight: '600'
                        },
                        padding: { top: 5, bottom: 15 }
                    },
                    beginAtZero: false
                }
            },
            interaction: {
                intersect: false,
                mode: 'index'
            },
            animation: {
                duration: 1000,
                easing: 'easeOutQuart'
            },
            elements: {
                line: {
                    tension: 0.2
                },
                point: {
                    radius: data.values.length > 100 ? 2 : 4,
                    hoverRadius: data.values.length > 100 ? 4 : 6
                }
            },
            layout: {
                padding: {
                    top: 20,
                    right: 20,
                    bottom: 20,
                    left: 20
                }
            }
        },
        plugins: [{
            id: 'customBackground',
            beforeDraw: (chart) => {
                const ctx = chart.ctx;
                ctx.save();
                ctx.globalCompositeOperation = 'destination-over';
                ctx.fillStyle = state.currentTheme === 'dark' ? 'rgba(26, 32, 44, 0.8)' : 'rgba(255, 255, 255, 0.8)';
                ctx.fillRect(0, 0, chart.width, chart.height);
                ctx.restore();
            }
        }]
    });
}

function updateChartTheme() {
    if (!state.chartInstance) return;
    
    const data = state.timeseriesData;
    const varConfig = CONFIG.variables[data.variable];
    const ctx = elements.timeseriesChart.getContext('2d');
    
    // Update gradient
    const gradient = ctx.createLinearGradient(0, 0, 0, 400);
    if (state.currentTheme === 'dark') {
        gradient.addColorStop(0, 'rgba(99, 179, 237, 0.8)');
        gradient.addColorStop(0.5, 'rgba(99, 179, 237, 0.3)');
        gradient.addColorStop(1, 'rgba(99, 179, 237, 0.05)');
    } else {
        gradient.addColorStop(0, 'rgba(49, 130, 206, 0.8)');
        gradient.addColorStop(0.5, 'rgba(49, 130, 206, 0.3)');
        gradient.addColorStop(1, 'rgba(49, 130, 206, 0.05)');
    }
    
    // Update colors
    const gridColor = state.currentTheme === 'dark' ? 'rgba(74, 85, 104, 0.3)' : 'rgba(203, 213, 224, 0.5)';
    const textColor = state.currentTheme === 'dark' ? '#a0aec0' : '#4a5568';
    const backgroundColor = state.currentTheme === 'dark' ? 'rgba(26, 32, 44, 0.95)' : 'rgba(255, 255, 255, 0.95)';
    const borderColor = state.currentTheme === 'dark' ? '#63b3ed' : '#3182ce';
    
    // Update chart options
    state.chartInstance.options.scales.x.grid.color = gridColor;
    state.chartInstance.options.scales.x.ticks.color = textColor;
    state.chartInstance.options.scales.x.title.color = textColor;
    state.chartInstance.options.scales.y.grid.color = gridColor;
    state.chartInstance.options.scales.y.ticks.color = textColor;
    state.chartInstance.options.scales.y.title.color = textColor;
    state.chartInstance.options.plugins.legend.labels.color = textColor;
    state.chartInstance.options.plugins.tooltip.backgroundColor = backgroundColor;
    state.chartInstance.options.plugins.tooltip.titleColor = textColor;
    state.chartInstance.options.plugins.tooltip.bodyColor = textColor;
    state.chartInstance.options.plugins.tooltip.borderColor = borderColor;
    
    // Update dataset
    state.chartInstance.data.datasets[0].borderColor = borderColor;
    state.chartInstance.data.datasets[0].backgroundColor = gradient;
    state.chartInstance.data.datasets[0].pointBackgroundColor = borderColor;
    state.chartInstance.data.datasets[0].pointHoverBorderColor = borderColor;
    
    // Update custom background plugin
    state.chartInstance.options.plugins.customBackground = {
        beforeDraw: (chart) => {
            const ctx = chart.ctx;
            ctx.save();
            ctx.globalCompositeOperation = 'destination-over';
            ctx.fillStyle = state.currentTheme === 'dark' ? 'rgba(26, 32, 44, 0.8)' : 'rgba(255, 255, 255, 0.8)';
            ctx.fillRect(0, 0, chart.width, chart.height);
            ctx.restore();
        }
    };
    
    state.chartInstance.update('none');
}

function exportChartAsImage() {
    if (!state.chartInstance) {
        updateStatus('No chart to export', 'warn');
        return;
    }
    
    try {
        const link = document.createElement('a');
        const timestamp = new Date().toISOString().split('T')[0];
        const location = state.timeseriesData ? 
            `${state.timeseriesData.lat.toFixed(2)}_${state.timeseriesData.lon.toFixed(2)}` : 'location';
        const variable = state.timeseriesData?.variable || 'data';
        
        link.download = `wrf_chart_${variable}_${location}_${timestamp}.png`;
        link.href = state.chartInstance.toBase64Image();
        link.click();
        
        updateStatus('Chart exported as PNG image', 'success');
    } catch (error) {
        debug('Error exporting chart:', error);
        updateStatus('Failed to export chart', 'error');
    }
}

function downloadTimeseriesCSV() {
    const data = state.timeseriesData;
    const varConfig = CONFIG.variables[data.variable];
    
    if (!data || data.values.length === 0) {
        updateStatus('No data to download', 'warn');
        return;
    }
    
    try {
        // Create CSV content
        let csvContent = "data:text/csv;charset=utf-8,";
        
        // Add metadata header
        csvContent += `WRF Forecast Timeseries Analysis\n`;
        csvContent += `Generated: ${new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })} IST\n`;
        csvContent += `Location: ${data.lat.toFixed(6)}°N, ${data.lon.toFixed(6)}°E\n`;
        csvContent += `Variable: ${varConfig.name} (${varConfig.unit})\n`;
        csvContent += `Grid Cell: [${data.gridI}, ${data.gridJ}]\n`;
        csvContent += `Total Forecast Hours: ${state.totalForecastHours}\n`;
        csvContent += `Data Points: ${data.values.length}\n`;
        csvContent += `Forecast Start: ${formatISTTime(CONFIG.forecastStart)}\n`;
        csvContent += `\n`;
        
        // Data header
        csvContent += "Forecast Hour,Date Time (IST)," + varConfig.name + " (" + varConfig.unit + ")\n";
        
        // Add data rows
        data.hours.forEach((hour, index) => {
            const timestamp = data.timestamps[index];
            const formattedTime = timestamp.toLocaleString('en-IN', {
                timeZone: 'Asia/Kolkata',
                year: 'numeric',
                month: '2-digit',
                day: '2-digit',
                hour: '2-digit',
                minute: '2-digit',
                second: '2-digit',
                hour12: false
            }).replace(',', '');
            
            csvContent += `${hour},${formattedTime},${data.values[index].toFixed(varConfig.precision)}\n`;
        });
        
        // Add summary statistics
        if (data.values.length > 0) {
            const min = Math.min(...data.values);
            const max = Math.max(...data.values);
            const sum = data.values.reduce((a, b) => a + b, 0);
            const avg = sum / data.values.length;
            const variance = data.values.reduce((acc, val) => acc + Math.pow(val - avg, 2), 0) / data.values.length;
            const stdDev = Math.sqrt(variance);
            
            csvContent += `\n`;
            csvContent += `Summary Statistics\n`;
            csvContent += `Minimum,${min.toFixed(varConfig.precision)} ${varConfig.unit}\n`;
            csvContent += `Maximum,${max.toFixed(varConfig.precision)} ${varConfig.unit}\n`;
            csvContent += `Average,${avg.toFixed(varConfig.precision)} ${varConfig.unit}\n`;
            csvContent += `Standard Deviation,${stdDev.toFixed(varConfig.precision)} ${varConfig.unit}\n`;
            csvContent += `Range,${(max - min).toFixed(varConfig.precision)} ${varConfig.unit}\n`;
            csvContent += `Total Points,${data.values.length}\n`;
        }
        
        // Create download link
        const encodedUri = encodeURI(csvContent);
        const link = document.createElement('a');
        const timestamp = new Date().toISOString().split('T')[0];
        const location = `${data.lat.toFixed(4)}_${data.lon.toFixed(4)}`;
        
        link.setAttribute('href', encodedUri);
        link.setAttribute('download', `wrf_timeseries_${data.variable}_${location}_${timestamp}.csv`);
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        
        updateStatus('CSV downloaded successfully', 'success');
    } catch (error) {
        debug('Error downloading CSV:', error);
        updateStatus('Failed to download CSV', 'error');
    }
}

// ==================== INITIALIZE BASEMAP ====================
function initializeBasemap(theme) {
    if (!state.map) return;
    
    // Remove current base layer if it exists
    if (state.baseLayer) {
        state.map.removeLayer(state.baseLayer);
    }
    
    // Choose appropriate tile layer based on theme
    let tileLayerUrl, tileAttribution;
    
    if (theme === 'dark') {
        // Dark theme: CartoDB Dark (WITH labels)
        tileLayerUrl = 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png';
        tileAttribution = '© OpenStreetMap, © CartoDB';
    } else {
        // Light theme: CartoDB Light (WITH labels)
        tileLayerUrl = 'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png';
        tileAttribution = '© OpenStreetMap, © CartoDB';
    }
    
    // Add new base layer
    state.baseLayer = L.tileLayer(tileLayerUrl, {
        maxZoom: 12,
        attribution: tileAttribution,
        detectRetina: false,
        updateWhenIdle: true,
        keepBuffer: 2
    }).addTo(state.map);
    
    debug(`Basemap initialized with ${theme} theme`);
}

// ==================== UPDATE BASE MAP THEME ====================
function updateBaseMapTheme(theme) {
    if (!state.map) return;
    
    // Remove current base layer if it exists
    if (state.baseLayer) {
        state.map.removeLayer(state.baseLayer);
    }
    
    // Choose appropriate tile layer based on theme
    let tileLayerUrl, tileAttribution;
    
    if (theme === 'dark') {
        // Dark theme: CartoDB Dark (WITH labels)
        tileLayerUrl = 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png';
        tileAttribution = '© OpenStreetMap, © CartoDB';
    } else {
        // Light theme: CartoDB Light (WITH labels)
        tileLayerUrl = 'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png';
        tileAttribution = '© OpenStreetMap, © CartoDB';
    }
    
    // Add new base layer
    state.baseLayer = L.tileLayer(tileLayerUrl, {
        maxZoom: 12,
        attribution: tileAttribution,
        detectRetina: false,
        updateWhenIdle: true,
        keepBuffer: 2
    }).addTo(state.map);
    
    debug(`Basemap updated to ${theme} theme`);
}

// ==================== INITIALIZE MAP ====================
function initializeMap() {
    debug('Initializing map...');
    
    // Create map with larger view bounds
    state.map = L.map('map', {
        attributionControl: false,
        zoomControl: true,
        minZoom: 6,
        maxZoom: 12,
        maxBounds: CONFIG.mapViewBounds,
        zoomControl: false,
        preferCanvas: true,
        fadeAnimation: false,
        markerZoomAnimation: false
    });
    
    // Add zoom control with custom position
    L.control.zoom({
        position: 'bottomright'
    }).addTo(state.map);
    
    // Set initial view to cover entire Uttarakhand region
    state.map.fitBounds(CONFIG.mapViewBounds);
    
    // Add WRF domain rectangle with thin border
    state.markers.boundaryLayer = L.rectangle(CONFIG.wrfBounds, {
        color: '#FF4444',
        weight: 1,
        fillColor: '#FF4444',
        fillOpacity: 0.05,
        interactive: true
    }).addTo(state.map);
    
    debug('Map canvas initialized');
}

// ==================== COORDINATE CHECK ====================
function isInWRFDomain(lat, lon) {
    const [sw, ne] = CONFIG.wrfBounds;
    return lat >= sw[0] && lat <= ne[0] && lon >= sw[1] && lon <= ne[1];
}

// ==================== LOAD GRID DATA ====================
async function loadGridData(fh) {
    const variable = elements.varSelect.value;
    const cacheKey = `${variable}_${fh}`;
    
    // Return cached data if available
    if (state.allGrids[cacheKey]) {
        debug(`Using cached grid for ${variable} FH ${fh}`);
        state.currentGrid = state.allGrids[cacheKey];
        return true;
    }
    
    try {
        updateStatus(`Loading ${CONFIG.variables[variable].name} data...`, 'info');
        
        // Try different filename patterns
        let response;
        const paddedFH = fh.toString().padStart(3, '0');
        
        // Try pattern 1: variable_000.json
        response = await fetch(`data_json/${variable}/${variable}_${paddedFH}.json`);
        
        if (!response.ok) {
            // Try pattern 2: variable_0.json (without padding)
            response = await fetch(`data_json/${variable}/${variable}_${fh}.json`);
        }
        
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }
        
        const gridData = await response.json();
        
        // Validate data structure
        if (!gridData || !gridData.values || !Array.isArray(gridData.values)) {
            throw new Error('Invalid JSON structure');
        }
        
        // Validate grid dimensions
        if (!gridData.ny || !gridData.nx) {
            throw new Error('Invalid JSON structure - missing grid dimensions');
        }
        
        // Store in cache
        state.allGrids[cacheKey] = gridData;
        state.currentGrid = gridData;
        
        debug(`Grid loaded: ${gridData.ny}×${gridData.nx}`);
        
        updateStatus(`Data loaded for FH ${fh}`, 'success');
        return true;
        
    } catch (error) {
        debug(`Failed to load grid: ${error.message}`, 'error');
        state.currentGrid = createTestGrid();
        updateStatus(`Loading data...`, 'warn');
        return false;
    }
}

// ==================== TEST GRID CREATION ====================
function createTestGrid() {
    const nx = 129, ny = 129;
    const values = [];
    
    for (let i = 0; i < ny; i++) {
        const row = [];
        for (let j = 0; j < nx; j++) {
            const southToNorth = i / (ny - 1);
            const baseTemp = 30 - (southToNorth * 40);
            const eastWest = Math.sin((j / (nx - 1)) * Math.PI) * 5;
            const noise = (Math.random() - 0.5) * 2;
            row.push(parseFloat((baseTemp + eastWest + noise).toFixed(2)));
        }
        values.push(row);
    }
    
    return {
        lat_min: CONFIG.wrfBounds[0][0],
        lat_max: CONFIG.wrfBounds[1][0],
        lon_min: CONFIG.wrfBounds[0][1],
        lon_max: CONFIG.wrfBounds[1][1],
        nx: nx,
        ny: ny,
        values: values
    };
}

// ==================== COORDINATE TO GRID CONVERSION ====================
function latLonToGridIndex(lat, lon) {
    if (!state.currentGrid) return null;
    
    const grid = state.currentGrid;
    
    // Check if within domain
    if (!isInWRFDomain(lat, lon)) {
        return null;
    }
    
    // Calculate normalized position
    const latNorm = (lat - grid.lat_min) / (grid.lat_max - grid.lat_min);
    const lonNorm = (lon - grid.lon_min) / (grid.lon_max - grid.lon_min);
    
    const array_i = Math.floor(latNorm * (grid.ny - 1));
    const array_j = Math.floor(lonNorm * (grid.nx - 1));
    
    const clampedI = Math.max(0, Math.min(array_i, grid.ny - 1));
    const clampedJ = Math.max(0, Math.min(array_j, grid.nx - 1));
    
    return { 
        i: clampedI,
        j: clampedJ,
        geo_i: clampedI
    };
}

// ==================== GET VALUE AT COORDINATES ====================
function getValueAtCoordinates(lat, lon) {
    if (!state.currentGrid || !state.currentGrid.values) {
        return { value: null, gridIndex: null };
    }
    
    // First check if in domain
    if (!isInWRFDomain(lat, lon)) {
        return { value: null, gridIndex: null, message: 'Outside domain' };
    }
    
    const gridIndex = latLonToGridIndex(lat, lon);
    if (!gridIndex) {
        return { value: null, gridIndex: null };
    }
    
    const grid = state.currentGrid;
    
    if (gridIndex.i >= grid.values.length || 
        gridIndex.j >= grid.values[0].length) {
        return { value: null, gridIndex };
    }
    
    const value = grid.values[gridIndex.i][gridIndex.j];
    
    if (value === null || value === undefined || isNaN(value)) {
        return { value: null, gridIndex };
    }
    
    return { 
        value, 
        gridIndex: { 
            i: gridIndex.i,
            j: gridIndex.j,
            geo_i: gridIndex.geo_i
        } 
    };
}

// ==================== UPDATE COORDINATE DISPLAY ====================
function updateCoordinateDisplay(lat, lon) {
    elements.lat.textContent = `Lat: ${lat.toFixed(4)}°`;
    elements.lon.textContent = `Lon: ${lon.toFixed(4)}°`;
    
    if (!isInWRFDomain(lat, lon)) {
        elements.lat.style.color = '#f56565';
        elements.lon.style.color = '#f56565';
    } else {
        elements.lat.style.color = 'var(--lat-color)';
        elements.lon.style.color = 'var(--lon-color)';
    }
}

// ==================== UPDATE VALUE DISPLAY ====================
function updateValueDisplay(lat, lon) {
    const result = getValueAtCoordinates(lat, lon);
    const variable = elements.varSelect.value;
    const varConfig = CONFIG.variables[variable];
    
    if (result.message === 'Outside domain') {
        elements.varValue.innerHTML = `<span style="color: var(--error-color); font-size: 1.3rem;">Outside WRF Domain</span>`;
        elements.gridInfo.textContent = '--';
        return;
    }
    
    if (result.value === null) {
        elements.varValue.innerHTML = `<span style="color: var(--warning-color); font-size: 1.3rem;">No data</span>`;
        elements.gridInfo.textContent = result.gridIndex ? 
            `Grid: [${result.gridIndex.geo_i}, ${result.gridIndex.j}]` : '--';
        return;
    }
    
    // Format the value
    const formattedValue = result.value.toFixed(varConfig.precision);
    const unit = varConfig.unit;
    
    // Update display with animation
    elements.varValue.innerHTML = `<span class="value-update" style="font-size: 1.8rem;">${formattedValue} ${unit}</span>`;
    
    // Add description based on variable
    let description = '';
    if (variable === 'T2') {
        const temp = result.value;
        if (temp < 0) description = '❄️ Very Cold';
        else if (temp < 10) description = '🥶 Cold';
        else if (temp < 20) description = '😊 Cool';
        else if (temp < 30) description = '😌 Warm';
        else description = '🥵 Hot';
    } else if (variable === 'RAIN') {
        const rain = result.value;
        if (rain < 0.1) description = '🌤️ Dry';
        else if (rain < 2.5) description = '🌦️ Light';
        else if (rain < 7.5) description = '🌧️ Moderate';
        else description = '⛈️ Heavy';
    } else if (variable === 'WIND') {
        const wind = result.value;
        if (wind < 0.5) description = '🍃 Calm';
        else if (wind < 3.5) description = '💨 Gentle';
        else description = '💨 Strong';
    }
    
    elements.gridInfo.textContent = `Grid: [${result.gridIndex.geo_i}, ${result.gridIndex.j}] ${description}`;
}

// ==================== UPDATE VARIABLE ICON ====================
function updateVariableIcon(variable) {
    const iconMap = {
        T2: '<i class="fas fa-thermometer-half"></i>',
        RH: '<i class="fas fa-tint"></i>',
        WIND: '<i class="fas fa-wind"></i>',
        RAIN: '<i class="fas fa-cloud-rain"></i>'
    };
    
    const icon = iconMap[variable] || '<i class="fas fa-chart-line"></i>';
    elements.variableIcon.innerHTML = icon;
}

// ==================== UPDATE VARIABLE DISPLAY ====================
function updateVariableDisplay() {
    const variable = elements.varSelect.value;
    const varConfig = CONFIG.variables[variable];
    
    elements.variableName.textContent = varConfig.name;
    updateVariableIcon(variable);
    
    // Update colorbar
    const cbarPath = `data/${variable}/${variable}_colorbar.png`;
    elements.cbar.src = cbarPath;
    
    elements.cbar.onerror = () => {
        console.log(`Colorbar not found: ${cbarPath}`);
        elements.cbar.style.display = 'none';
    };
    
    elements.cbar.onload = () => {
        elements.cbar.style.display = 'block';
    };
}

// ==================== FIXED: NO BLINKING, INSTANT FRAME CHANGE ====================
async function updateMapLayer(fh) {
    const variable = elements.varSelect.value;
    
    // Try different image naming patterns
    let imagePath;
    const paddedFH = fh.toString().padStart(3, '0');
    
    // Try pattern 1: variable_fc_000.png
    imagePath = `data/${variable}/${variable}_fc_${paddedFH}.png`;
    
    return new Promise((resolve) => {
        const img = new Image();
        img.crossOrigin = "Anonymous";
        
        img.onload = () => {
            // Remove current layer IMMEDIATELY - NO FADE, NO WAITING
            if (state.currentLayer) {
                state.map.removeLayer(state.currentLayer);
                state.currentLayer = null;
            }
            
            // Add new layer with FULL OPACITY immediately - NO FADE IN
            const newLayer = L.imageOverlay(imagePath, CONFIG.wrfBounds, {
                opacity: 1.0,  // Full opacity immediately
                interactive: false
            }).addTo(state.map);
            
            state.currentLayer = newLayer;
            resolve(true);
        };
        
        img.onerror = () => {
            // Try alternative pattern: variable_000.png
            imagePath = `data/${variable}/${variable}_${paddedFH}.png`;
            img.src = imagePath;
            
            img.onerror = () => {
                debug(`Image not found: ${imagePath}`, 'error');
                resolve(false);
            };
        };
        
        img.src = imagePath;
    });
}

// ==================== SHOW FRAME ====================
async function showFrame(fh) {
    debug(`Showing frame ${fh}...`);
    
    state.currentFH = fh;
    elements.slider.value = fh;
    
    // Update displays
    updateTimeDisplay(fh);
    updateVariableDisplay();
    
    // Load data and update map
    await loadGridData(fh);
    await updateMapLayer(fh);
    
    // Update last click position if exists
    if (state.lastClickPos) {
        const { lat, lng } = state.lastClickPos;
        updateCoordinateDisplay(lat, lng);
        updateValueDisplay(lat, lng);
    }
    
    debug(`Frame ${fh} displayed`);
}

// ==================== ANIMATION CONTROL ====================
function updatePlayButton() {
    // Update button text based on actual play state
    elements.playBtn.innerHTML = state.isPlaying 
        ? '<i class="fas fa-pause"></i> Pause' 
        : '<i class="fas fa-play"></i> Play';
}

function advanceFrame() {
    let nextFH = parseInt(elements.slider.value);
    nextFH = (nextFH < state.totalForecastHours) ? nextFH + 1 : 0;
    showFrame(nextFH);
}

function startAnimation() {
    if (state.isPlaying) return;
    state.isPlaying = true;
    updatePlayButton();
    state.timer = setInterval(advanceFrame, CONFIG.baseFrameTime / state.currentSpeed);
}

function stopAnimation() {
    if (!state.isPlaying) return;
    state.isPlaying = false;
    clearInterval(state.timer);
    state.timer = null;
    updatePlayButton();
}

function toggleAnimation() {
    state.isPlaying ? stopAnimation() : startAnimation();
}

// ==================== EVENT LISTENERS ====================
function setupEventListeners() {
    debug('Setting up event listeners...');
    
    // Play/Pause button
    elements.playBtn.addEventListener('click', toggleAnimation);
    
    // Speed control
    elements.speedSelect.addEventListener('change', (e) => {
        state.currentSpeed = parseFloat(e.target.value);
        if (state.isPlaying) {
            stopAnimation();
            startAnimation();
        }
    });
    
    // Time slider
    elements.slider.addEventListener('input', (e) => {
        stopAnimation();
        showFrame(parseInt(e.target.value));
    });
    
    // Variable selection
    elements.varSelect.addEventListener('change', () => {
        stopAnimation();
        state.allGrids = {};
        // Update slider max based on detected hours
        detectTotalForecastHours().then(() => {
            showFrame(state.currentFH);
        });
    });
    
    // Navigation buttons
    elements.nextBtn.addEventListener('click', () => {
        stopAnimation();
        const nextFH = Math.min(parseInt(elements.slider.value) + 1, state.totalForecastHours);
        showFrame(nextFH);
    });
    
    elements.prevBtn.addEventListener('click', () => {
        stopAnimation();
        const prevFH = Math.max(parseInt(elements.slider.value) - 1, 0);
        showFrame(prevFH);
    });
    
    // Map mouse movement
    state.map.on('mousemove', (e) => {
        const { lat, lng } = e.latlng;
        updateCoordinateDisplay(lat, lng);
        updateValueDisplay(lat, lng);
    });
    
    // Map click - show value and marker, then open timeseries chart
    state.map.on('click', async (e) => {
        const { lat, lng } = e.latlng;
        state.lastClickPos = e.latlng;
        
        // Get grid coordinates
        const result = getValueAtCoordinates(lat, lng);
        
        // Add/update marker
        if (state.markers.clickMarker) {
            state.map.removeLayer(state.markers.clickMarker);
        }
        
        state.markers.clickMarker = L.marker([lat, lng], {
            icon: L.divIcon({
                className: 'click-marker',
                html: '<div style="background: radial-gradient(circle, #2196F3 40%, #1976D2); width: 16px; height: 16px; border-radius: 50%; border: 3px solid white; box-shadow: 0 2px 8px rgba(0,0,0,0.5);"></div>',
                iconSize: [22, 22]
            })
        }).addTo(state.map);
        
        // Show value in tooltip
        if (result.value !== null) {
            const variable = elements.varSelect.value;
            const varConfig = CONFIG.variables[variable];
            const formattedValue = result.value.toFixed(varConfig.precision);
            
            state.markers.clickMarker.bindTooltip(
                `<b>${varConfig.name}:</b> ${formattedValue} ${varConfig.unit}<br>
                <small>Grid: [${result.gridIndex.geo_i}, ${result.gridIndex.j}]</small><br>
                <small>Click for timeseries</small>`,
                { 
                    permanent: true, 
                    direction: 'top',
                    className: 'value-tooltip'
                }
            ).openTooltip();
        }
        
        updateValueDisplay(lat, lng);
        
        // Load and show timeseries chart if within domain
        if (result.gridIndex && result.value !== null) {
            const variable = elements.varSelect.value;
            updateStatus('Opening timeseries chart...', 'info');
            
            // Open chart immediately
            await showTimeseriesChart(lat, lng, variable, result.gridIndex.i, result.gridIndex.j);
        }
    });
    
    // Chart download button
    elements.downloadCSVBtn.addEventListener('click', downloadTimeseriesCSV);
    
    // Chart export button
    elements.exportChartBtn.addEventListener('click', exportChartAsImage);
    
    // Close chart modal buttons
    elements.closeChartBtn.addEventListener('click', () => {
        elements.chartModal.style.display = 'none';
    });
    
    elements.chartModalClose.addEventListener('click', () => {
        elements.chartModal.style.display = 'none';
    });
    
    // Close modal when clicking outside
    window.addEventListener('click', (e) => {
        if (e.target === elements.chartModal) {
            elements.chartModal.style.display = 'none';
        }
    });
    
    // Add mouseenter/mouseleave events for better UX
    state.map.on('mouseenter', () => {
        document.body.style.cursor = 'crosshair';
    });
    
    state.map.on('mouseleave', () => {
        document.body.style.cursor = 'default';
    });
    
    // Keyboard shortcuts
    document.addEventListener('keydown', (e) => {
        if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') return;
        
        switch(e.key) {
            case ' ':
                e.preventDefault();
                toggleAnimation(); 
                break;
            case 'ArrowRight': 
                elements.nextBtn.click(); 
                break;
            case 'ArrowLeft': 
                elements.prevBtn.click(); 
                break;
            case '0':
                stopAnimation();
                showFrame(0);
                break;
            case 't':
            case 'T':
                // Toggle theme
                elements.themeToggle.click();
                break;
            case 'c':
            case 'C':
                // Show chart if available
                if (state.timeseriesData.values.length > 0 && !elements.chartModal.style.display || elements.chartModal.style.display === 'none') {
                    showTimeseriesChart(
                        state.timeseriesData.lat,
                        state.timeseriesData.lon,
                        state.timeseriesData.variable,
                        state.timeseriesData.gridI,
                        state.timeseriesData.gridJ
                    );
                }
                break;
            case 'd':
            case 'D':
                // Download CSV if available
                if (state.timeseriesData.values.length > 0) {
                    downloadTimeseriesCSV();
                }
                break;
            case 'e':
            case 'E':
                // Export chart if available
                if (state.chartInstance) {
                    exportChartAsImage();
                }
                break;
            case 'Escape':
                // Close chart modal
                elements.chartModal.style.display = 'none';
                break;
            case 'r':
            case 'R':
                // Reset animation
                stopAnimation();
                startAnimation();
                break;
            case 'm':
            case 'M':
                // Toggle marker
                if (state.markers.clickMarker) {
                    state.map.removeLayer(state.markers.clickMarker);
                    state.markers.clickMarker = null;
                }
                break;
        }
    });
    
    // Handle window resize for better responsiveness
    window.addEventListener('resize', () => {
        if (state.map) {
            setTimeout(() => {
                state.map.invalidateSize();
            }, 100);
        }
        if (state.chartInstance) {
            state.chartInstance.resize();
        }
    });
}

// ==================== SETUP CORS WORKAROUND ====================
function setupCorsWorkaround() {
    const env = detectEnvironment();
    
    if (env.isFileProtocol) {
        debug('FILE PROTOCOL DETECTED - CORS restrictions apply');
        updateStatus('⚠️ CORS restrictions detected. Use a local server for best results.', 'warn');
        
        // Add a visible warning to the user
        const warningDiv = document.createElement('div');
        warningDiv.innerHTML = `
            <div style="
                background: linear-gradient(135deg, #fff3cd, #ffeaa7);
                border: 1px solid #ffd54f;
                border-radius: 8px;
                padding: 10px 15px;
                margin: 10px 25px;
                color: #856404;
                box-shadow: 0 3px 8px rgba(255, 213, 79, 0.2);
                font-size: 1rem;
            ">
                <strong><i class="fas fa-exclamation-triangle"></i> CORS Warning:</strong> Running from file:// may cause data loading issues.
                <br>
                <small>For best results, run a local server:</small>
                <br>
                <code style="background: #f8f9fa; padding: 4px 8px; border-radius: 4px; margin: 4px 0; display: inline-block; font-size: 0.9rem;">
                    python3 -m http.server 8000
                </code>
                <br>
                Then open: <a href="http://localhost:8000" target="_blank" style="color: #1976D2; text-decoration: none; font-weight: 600; font-size: 0.9rem;">http://localhost:8000</a>
            </div>
        `;
        
        // Insert warning at the top of the dashboard
        const colorbarSection = document.querySelector('.colorbar-section');
        if (colorbarSection) {
            colorbarSection.insertBefore(warningDiv, colorbarSection.firstChild);
        }
    }
}

// ==================== DETECT ENVIRONMENT ====================
function detectEnvironment() {
    const isFileProtocol = window.location.protocol === 'file:';
    const isLocalhost = window.location.hostname === 'localhost' || 
                        window.location.hostname === '127.0.0.1';
    
    debug('Environment detection:', {
        protocol: window.location.protocol,
        hostname: window.location.hostname,
        isFileProtocol: isFileProtocol,
        isLocalhost: isLocalhost
    });
    
    return {
        isFileProtocol: isFileProtocol,
        isLocalhost: isLocalhost,
        basePath: isFileProtocol ? '.' : ''
    };
}

// ==================== PRELOAD NEXT FRAME ====================
function preloadNextFrame() {
    const nextFH = (state.currentFH + 1) % (state.totalForecastHours + 1);
    const variable = elements.varSelect.value;
    const cacheKey = `${variable}_${nextFH}`;
    
    // Preload JSON data if not already cached
    if (!state.allGrids[cacheKey]) {
        fetch(`data_json/${variable}/${variable}_${nextFH.toString().padStart(3, '0')}.json`)
            .then(response => {
                if (response.ok) return response.json();
                // Try alternative naming
                return fetch(`data_json/${variable}/${variable}_${nextFH}.json`);
            })
            .then(response => {
                if (response && response.ok) return response.json();
                throw new Error('Failed to load');
            })
            .then(data => {
                if (data && data.values) {
                    state.allGrids[cacheKey] = data;
                    debug(`Preloaded frame ${nextFH}`);
                }
            })
            .catch(error => {
                debug(`Failed to preload frame ${nextFH}:`, error);
            });
    }
}

// ==================== INITIALIZE DASHBOARD ====================
async function initializeDashboard() {
    debug('Starting dashboard initialization...');
    
    try {
        // Initialize map FIRST
        initializeMap();
        
        // Detect total forecast hours
        await detectTotalForecastHours();
        
        // Setup theme toggle (this will initialize the basemap immediately)
        setupThemeToggle();
        
        // Setup event listeners (including timeseries)
        setupEventListeners();
        
        // Check for CORS issues
        setupCorsWorkaround();
        
        // Initialize play button to show "Play" (not "Pause")
        updatePlayButton();
        
        // Show initial frame
        await showFrame(0);
        
        // Set initial status
        updateStatus('Dashboard ready - Click on map to view timeseries', 'success');
        
        // Start preloading frames
        setInterval(preloadNextFrame, 5000);
        
        // Debug info
        setTimeout(() => {
            debug('=== SYSTEM CHECK ===');
            debug('Environment:', detectEnvironment());
            debug('Theme:', state.currentTheme);
            debug('Map initialized:', !!state.map);
            debug('Basemap loaded:', !!state.baseLayer);
            debug('Current grid loaded:', !!state.currentGrid);
            debug('Current variable:', elements.varSelect.value);
            debug('Current FH:', state.currentFH);
            debug('Total Forecast Hours:', state.totalForecastHours);
            debug('Animation state:', state.isPlaying ? 'Playing' : 'Paused');
            debug('Animation speed:', state.currentSpeed);
        }, 1000);
        
        debug('Dashboard initialized successfully');
        
    } catch (error) {
        console.error('Initialization error:', error);
        updateStatus(`Error: ${error.message}`, 'error');
        
        // Show user-friendly error
        alert(`Dashboard failed to load: ${error.message}\n\nPossible solutions:\n1. Run a local server (python3 -m http.server 8000)\n2. Check browser console for details\n3. Ensure data files exist in correct locations`);
    }
}

// ==================== START APPLICATION ====================
document.addEventListener('DOMContentLoaded', initializeDashboard);

// Export for debugging
window.WRFDashboard = {
    config: CONFIG,
    state: state,
    elements: elements,
    isInWRFDomain,
    getValueAtCoordinates,
    showFrame,
    toggleAnimation,
    fetchTimeseriesData,
    showTimeseriesChart,
    downloadTimeseriesCSV,
    exportChartAsImage,
    detectTotalForecastHours
};
