// ==================== CONFIGURATION ====================
const CONFIG = {
    // Set forecast start time to IST (Indian Standard Time)
    forecastStart: new Date("2026-02-08T05:30:00"), // ADD +05:30 for IST
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
    currentTheme: 'light'
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
    variableName: document.getElementById("variableName"),
    variableIcon: document.getElementById("variableIcon"),
    cbar: document.getElementById("cbar"),
    lat: document.getElementById("lat"),
    lon: document.getElementById("lon"),
    varValue: document.getElementById("varValue"),
    gridInfo: document.getElementById("gridInfo"),
    status: document.getElementById("status"),
    statusIcon: document.getElementById("statusIcon"),
    themeToggle: document.getElementById("themeToggle")
};

// ==================== DEBUG AND LOGGING ====================
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

// ==================== THEME MANAGEMENT ====================
function setupThemeToggle() {
    // Check for saved theme or prefer-color-scheme
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    const savedTheme = localStorage.getItem('wrfTheme') || 'light';
    
    // Apply saved theme
    document.body.setAttribute('data-theme', savedTheme);
    state.currentTheme = savedTheme;
    updateThemeIcon(savedTheme);
    
    // Initialize basemap immediately
    initializeBasemap(savedTheme);
    
    // Toggle theme on button click
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
    });
    
    // Listen for system theme changes
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
    // Convert to IST (Indian Standard Time is UTC+5:30)
    const options = {
        timeZone: 'Asia/Kolkata',
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false // Use 24-hour format
    };
    
    // Format with IST timezone
    let formatted = date.toLocaleString('en-IN', options);
    
    // Add IST indicator
    const istTime = formatted + ' IST';
    
    // Format for better readability
    return istTime.replace(',', '').replace(' AM', '').replace(' PM', '');
}

// ==================== UPDATE TIME DISPLAY (IST FORMAT) ====================
function updateTimeDisplay(fh) {
    elements.timeLabel.textContent = `+${fh} h`;
    elements.currentFH.textContent = fh;
    
    const forecastStart = CONFIG.forecastStart;
    const validTime = new Date(forecastStart.getTime() + fh * 3600 * 1000);
    
    // Use IST formatting
    elements.fcStart.textContent = formatISTTime(forecastStart);
    elements.fcValid.textContent = formatISTTime(validTime);
}

// Rest of the JavaScript code remains the same...
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
        
        const response = await fetch(`data_json/${variable}/${variable}_${fh.toString().padStart(3, '0')}.json`);
        
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

// ==================== UPDATE MAP LAYER ====================
async function updateMapLayer(fh) {
    const variable = elements.varSelect.value;
    let imagePath = `data/${variable}/${variable}_fc_${fh.toString().padStart(3, '0')}.png`;
    
    return new Promise((resolve) => {
        const img = new Image();
        img.crossOrigin = "Anonymous";
        
        img.onload = () => {
            // Create new layer with 0 opacity
            const newLayer = L.imageOverlay(imagePath, CONFIG.wrfBounds, {
                opacity: 0,
                interactive: false
            }).addTo(state.map);
            
            // Calculate fade duration based on current speed
            function fadeDuration() {
                return Math.min(800, (CONFIG.baseFrameTime / state.currentSpeed) * 0.85);
            }
            
            const start = performance.now();
            const dur = fadeDuration();
            
            function animate(timestamp) {
                const p = Math.min((timestamp - start) / dur, 1);
                
                // Use easing function for smoother transition
                // Ease-in-out quadratic
                const easedOpacity = p < 0.5 
                    ? 2 * p * p 
                    : 1 - Math.pow(-2 * p + 2, 2) / 2;
                
                newLayer.setOpacity(easedOpacity * 0.85);
                
                // Fade out old layer simultaneously
                if (state.currentLayer) {
                    state.currentLayer.setOpacity(0.85 - (easedOpacity * 0.85));
                }
                
                if (p < 1) {
                    requestAnimationFrame(animate);
                } else {
                    // Animation complete
                    if (state.currentLayer) {
                        state.map.removeLayer(state.currentLayer);
                    }
                    // Set final opacity
                    newLayer.setOpacity(0.85);
                    state.currentLayer = newLayer;
                    resolve(true);
                }
            }
            
            requestAnimationFrame(animate);
        };
        
        img.onerror = () => {
            debug(`Image not found: ${imagePath}`, 'error');
            resolve(false);
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
    nextFH = (nextFH < parseInt(elements.slider.max)) ? nextFH + 1 : 0;
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
    
    // Speed control (now in controls section)
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
        showFrame(state.currentFH);
    });
    
    // Navigation buttons
    elements.nextBtn.addEventListener('click', () => {
        stopAnimation();
        const nextFH = Math.min(parseInt(elements.slider.value) + 1, parseInt(elements.slider.max));
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
    
    // Map click - show value and marker
    state.map.on('click', (e) => {
        const { lat, lng } = e.latlng;
        state.lastClickPos = e.latlng;
        
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
        const result = getValueAtCoordinates(lat, lng);
        if (result.value !== null) {
            const variable = elements.varSelect.value;
            const varConfig = CONFIG.variables[variable];
            const formattedValue = result.value.toFixed(varConfig.precision);
            
            state.markers.clickMarker.bindTooltip(
                `<b>${varConfig.name}:</b> ${formattedValue} ${varConfig.unit}<br>
                <small>Grid: [${result.gridIndex.geo_i}, ${result.gridIndex.j}]</small>`,
                { 
                    permanent: true, 
                    direction: 'top',
                    className: 'value-tooltip'
                }
            ).openTooltip();
        }
        
        updateValueDisplay(lat, lng);
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
    const nextFH = (state.currentFH + 1) % 240;
    const variable = elements.varSelect.value;
    const cacheKey = `${variable}_${nextFH}`;
    
    // Preload JSON data if not already cached
    if (!state.allGrids[cacheKey]) {
        fetch(`data_json/${variable}/${variable}_${nextFH.toString().padStart(3, '0')}.json`)
            .then(response => response.json())
            .then(data => {
                state.allGrids[cacheKey] = data;
                debug(`Preloaded frame ${nextFH}`);
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
        
        // Setup theme toggle (this will initialize the basemap immediately)
        setupThemeToggle();
        
        // Check for CORS issues
        setupCorsWorkaround();
        
        // Setup event listeners
        setupEventListeners();
        
        // Initialize play button to show "Play" (not "Pause")
        updatePlayButton();
        
        // Show initial frame
        await showFrame(0);
        
        // Set initial status
        updateStatus('Dashboard ready - Click play to start animation', 'success');
        
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
    toggleAnimation
};