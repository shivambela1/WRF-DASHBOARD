// ================= USER SETTINGS =================
const forecastStart = new Date("2026-02-08T00:00:00");
const BASE_FRAME_TIME = 1000;   // 1× speed (ms)

// ================= UI ELEMENTS ===================
const slider = document.getElementById("timeSlider");
const label  = document.getElementById("timeLabel");
const latlonDiv = document.getElementById("latlon");
const cbarImg = document.getElementById("cbar");
const varSelect = document.getElementById("varSelect");
const playBtn = document.getElementById("playBtn");
const speedSelect = document.getElementById("speedSelect");
const nextBtn = document.getElementById("nextBtn");
const prevBtn = document.getElementById("prevBtn");
const fcStartSpan = document.getElementById("fcStart");
const fcValidSpan = document.getElementById("fcValid");

// ================= DOMAIN ========================
const wrfBounds = [
  [28.3241, 77.3086],
  [31.7777, 81.2995]
];

// ================= MAP ===========================
const map = L.map("map", { attributionControl: false });

L.tileLayer(
  "https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png",
  { maxZoom: 10 }
).addTo(map);

map.fitBounds(wrfBounds);
map.setMaxBounds(wrfBounds);

// ================= IMAGE STATE ===================
let currentLayer = null;
let isPlaying = false;
let timer = null;
let currentSpeed = 1.0;

// ================= HELPERS =======================
function pad3(n) {
  return String(n).padStart(3, "0");
}

function imagePath(fh) {
  const v = varSelect.value;
  return `data/${v}/${v}_fc_${pad3(fh)}.png`;
}

function fadeDuration() {
  return Math.min(900, (BASE_FRAME_TIME / currentSpeed) * 0.9);
}

// ================= SMOOTH FRAME UPDATE ===========
function showFrame(fh) {

  const path = imagePath(fh);
  const img = new Image();
  img.src = path;

  img.onload = () => {
    const next = L.imageOverlay(
      path,
      wrfBounds,
      { opacity: 0, interactive: false }
    ).addTo(map);

    const start = performance.now();
    const dur = fadeDuration();

    function animate(t) {
      const p = Math.min((t - start) / dur, 1);
      next.setOpacity(p < 0.5 ? 2*p*p : 1 - Math.pow(-2*p + 2, 2)/2);

      if (p < 1) {
        requestAnimationFrame(animate);
      } else {
        if (currentLayer) map.removeLayer(currentLayer);
        currentLayer = next;
      }
    }

    requestAnimationFrame(animate);
  };

  slider.value = fh;
  label.innerText = `+${fh} h`;

  const valid = new Date(forecastStart.getTime() + fh * 3600 * 1000);
  fcStartSpan.innerText = forecastStart.toISOString().slice(0,16).replace("T"," ");
  fcValidSpan.innerText = valid.toISOString().slice(0,16).replace("T"," ");

  cbarImg.src = `data/${varSelect.value}/${varSelect.value}_colorbar.png`;
}

// ================= ANIMATION =====================
function advance() {
  let fh = +slider.value;
  fh = (fh < slider.max) ? fh + 1 : slider.min;
  showFrame(fh);
}

function start() {
  if (isPlaying) return;
  isPlaying = true;
  playBtn.innerText = "⏸ Pause";
  timer = setInterval(advance, BASE_FRAME_TIME / currentSpeed);
}

function stop() {
  if (!isPlaying) return;
  clearInterval(timer);
  timer = null;
  isPlaying = false;
  playBtn.innerText = "▶ Play";
}

// ================= CONTROLS ======================
playBtn.onclick = () => isPlaying ? stop() : start();

speedSelect.onchange = () => {
  currentSpeed = parseFloat(speedSelect.value);
  if (isPlaying) {
    stop();
    start();   // 🔥 THIS IS WHAT FIXES SPEED
  }
};

slider.oninput = () => {
  stop();
  showFrame(+slider.value);
};

varSelect.onchange = () => {
  stop();
  showFrame(+slider.value);
};

nextBtn.onclick = () => {
  stop();
  showFrame(Math.min(+slider.value + 1, slider.max));
};

prevBtn.onclick = () => {
  stop();
  showFrame(Math.max(+slider.value - 1, slider.min));
};

// ================= LAT–LON =======================
map.on("mousemove", e => {
  latlonDiv.innerText =
    `Lat: ${e.latlng.lat.toFixed(3)} , Lon: ${e.latlng.lng.toFixed(3)}`;
});

// ================= INITIAL =======================
showFrame(0);
start();   // 🔥 auto-run on open
