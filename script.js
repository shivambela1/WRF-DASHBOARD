// ------------------------------
// UI elements
// ------------------------------
const slider = document.getElementById("timeSlider");
const label  = document.getElementById("timeLabel");
const latlonDiv = document.getElementById("latlon");
const cbarImg = document.getElementById("cbar");
const varSelect = document.getElementById("varSelect");
const nextBtn = document.getElementById("nextBtn");
const prevBtn = document.getElementById("prevBtn");

// ------------------------------
// WRF domain bounds
// ------------------------------
const wrfBounds = [
  [28.428466796875, 77.15260314941406],
  [31.476028442382812, 81.24139404296875]
];

// ------------------------------
// Create map (WITH BASEMAP)
// ------------------------------
const map = L.map('map', {
  zoomControl: true,
  attributionControl: false
});

L.tileLayer(
  'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png',
  { maxZoom: 10 }
).addTo(map);

map.fitBounds(wrfBounds);
map.setMaxBounds(wrfBounds);
map.on('drag', () => map.panInsideBounds(wrfBounds));

// ------------------------------
// Forecast overlay
// ------------------------------
let wrfLayer;

function loadWRF() {
  const fh = slider.value.padStart(3, "0");
  const variable = varSelect.value;

  if (wrfLayer) map.removeLayer(wrfLayer);

  wrfLayer = L.imageOverlay(
    `data/${variable}/forecast/fh_${fh}.png`,
    wrfBounds,
    { opacity: 0.9, interactive: false }
  ).addTo(map);

  // Update colorbar
  cbarImg.src = `data/${variable}/cbar/fh_${fh}.png`;

  label.innerText = `FH +${slider.value}`;
}

// ------------------------------
// Initial load
// ------------------------------
loadWRF();

// ------------------------------
// Slider
// ------------------------------
slider.oninput = loadWRF;

// ------------------------------
// Variable selector
// ------------------------------
varSelect.onchange = loadWRF;

// ------------------------------
// Forward / backward buttons
// ------------------------------
nextBtn.onclick = () => {
  let v = parseInt(slider.value);
  if (v < parseInt(slider.max)) {
    slider.value = v + parseInt(slider.step);
    loadWRF();
  }
};

prevBtn.onclick = () => {
  let v = parseInt(slider.value);
  if (v > parseInt(slider.min)) {
    slider.value = v - parseInt(slider.step);
    loadWRF();
  }
};

// ------------------------------
// Mouse lat-lon
// ------------------------------
map.on('mousemove', function (e) {
  latlonDiv.innerText =
    `Lat: ${e.latlng.lat.toFixed(3)} , Lon: ${e.latlng.lng.toFixed(3)}`;
});
