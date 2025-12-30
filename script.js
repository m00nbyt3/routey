/* ==========================================
   CONFIGURACIÓN Y ESTADO
   ========================================== */
let timeout = null;
let map = null;
let markers = []; // Array para guardar referencias a los marcadores del mapa

document.addEventListener('DOMContentLoaded', () => {
    initMap();
    // 1. Solo dos paradas por defecto
    addStop(); // Origen
    addStop(); // Destino
});

/* ==========================================
   GESTIÓN DEL MAPA (LEAFLET)
   ========================================== */
function initMap() {
    // Coordenadas iniciales (Madrid por defecto o 0,0)
    map = L.map('map').setView([40.416, -3.703], 5);
    
    // Capa de mapa gratuita (OSM)
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '&copy; OpenStreetMap contributors'
    }).addTo(map);
}

function updateMap() {
    // Limpiar marcadores antiguos
    markers.forEach(m => map.removeLayer(m));
    markers = [];

    const inputs = document.querySelectorAll('input');
    const bounds = [];

    inputs.forEach((inp, index) => {
        const val = inp.dataset.val; // Valor limpio (coords o nombre)
        
        // Solo pintamos si tenemos coordenadas guardadas en el dataset
        // El formato que guardamos en smartSearch es "lat,lon"
        if (val && val.includes(',') && !val.match(/[a-zA-Z]/)) {
            const [lat, lon] = val.split(',').map(Number);
            
            if (!isNaN(lat) && !isNaN(lon)) {
                // Color diferente para origen (verde) y destino (rojo)
                const isOrigin = index === 0;
                const isDest = index === inputs.length - 1;
                let color = 'blue';
                if (isOrigin) color = 'green';
                if (isDest) color = 'red';

                // Crear marcador (usando círculos simples para no liar con iconos externos)
                const marker = L.circleMarker([lat, lon], {
                    color: color,
                    fillColor: color,
                    fillOpacity: 0.8,
                    radius: 8
                }).addTo(map);

                marker.bindPopup(`<b>${index === 0 ? "Origen" : (isDest ? "Destino" : "Parada " + index)}</b><br>${inp.value}`);
                markers.push(marker);
                bounds.push([lat, lon]);
            }
        }
    });

    // Ajustar zoom para ver todos los puntos
    if (bounds.length > 0) {
        map.fitBounds(bounds, { padding: [30, 30] });
    }
}

/* ==========================================
   GESTIÓN DE PARADAS (UI)
   ========================================== */
function addStop() {
    const list = document.getElementById('stops-list');
    const div = document.createElement('div');
    div.className = 'stop-row';
    
    div.innerHTML = `
        <div class="order-btns">
            <button class="btn-move" onclick="moveRow(this, -1)">▲</button>
            <button class="btn-move" onclick="moveRow(this, 1)">▼</button>
        </div>
        
        <div class="input-wrapper">
            <span class="stop-label">Parada</span>
            <input type="text" placeholder="URL, Coords o Nombre" oninput="handleInput(this)">
            <div class="details"></div>
        </div>

        <button class="btn-del" onclick="removeStop(this)" title="Eliminar parada">×</button>
    `;
    
    list.appendChild(div);
    refreshLabels();
}

function removeStop(btn) {
    const list = document.getElementById('stops-list');
    if (list.children.length <= 2) {
        alert("Debes tener al menos Origen y Destino.");
        return;
    }
    btn.closest('.stop-row').remove();
    refreshLabels();
    updateMap(); // Actualizar mapa al borrar
}

function moveRow(btn, direction) {
    const row = btn.closest('.stop-row');
    const list = document.getElementById('stops-list');
    const items = [...list.children];
    const index = items.indexOf(row);

    if (direction === -1 && index > 0) {
        list.insertBefore(row, items[index - 1]);
    } else if (direction === 1 && index < items.length - 1) {
        list.insertBefore(row, items[index + 1].nextSibling);
    }
    refreshLabels();
    generate(); // Regenerar URL si ya había datos
}

function refreshLabels() {
    const rows = document.querySelectorAll('.stop-row');
    rows.forEach((row, i) => {
        const label = row.querySelector('.stop-label');
        if (i === 0) label.textContent = "🚩 Origen";
        else if (i === rows.length - 1) label.textContent = "🏁 Destino";
        else label.textContent = `Parada ${i}`;
    });
}

/* ==========================================
   LÓGICA DE DETECCIÓN (NOMINATIM & URL)
   ========================================== */
function handleInput(input) {
    const details = input.nextElementSibling;
    details.innerHTML = '';
    clearTimeout(timeout);
    
    const val = input.value.trim();
    if(!val) {
        input.removeAttribute('data-val');
        updateMap();
        return;
    }

    // 1. URLs (Extracción rápida local)
    if (val.includes('http') || val.includes('google.com')) {
        let displayName = "Enlace Web";
        
        // A. Nombre en URL (/place/NOMBRE)
        if (val.includes('/place/')) {
            const m = val.match(/\/place\/([^\/]+)/);
            if (m && m[1]) {
                let cleanName = decodeURIComponent(m[1]).replace(/\+/g, ' ');
                if (cleanName.includes(',') && cleanName.length > 25) {
                    cleanName = cleanName.split(',')[0];
                }
                input.dataset.val = cleanName; 
                renderTag(details, "🏢 " + cleanName, 'blue');
                // Nota: Las URLs de nombre no tienen coordenadas fáciles para el mapa preview
                // a menos que llamemos a la API. Por ahora, solo actualizamos URL final.
                return;
            }
        }

        // B. Coordenadas ocultas en URL (!3d...!4d) -> Prioridad para el mapa
        const pin = val.match(/!3d(-?\d+\.\d+)!4d(-?\d+\.\d+)/);
        if (pin) {
            const lat = pin[1];
            const lon = pin[2];
            details.innerHTML = '<span class="loading">🔍 Identificando...</span>';
            resolveNameFromCoords(lat, lon, details, input);
            return;
        }
        
        // Fallback
        input.dataset.val = val;
        renderTag(details, "🔗 Enlace Detectado", 'gray');
        return;
    }

    // 2. Texto manual -> API Nominatim
    details.innerHTML = '<span class="loading">🔍 Buscando...</span>';
    timeout = setTimeout(() => {
        smartSearch(val, details, input);
    }, 700);
}

// --- API HELPERS ---
async function resolveNameFromCoords(lat, lon, container, input) {
    const data = await fetchReverse(lat, lon);
    // Guardamos coords para el mapa preview y para la ruta de Google
    input.dataset.val = `${lat},${lon}`; 
    
    if (data) {
        const name = extractShortName(data);
        renderTag(container, "🏢 " + name, 'blue');
    } else {
        renderTag(container, `📍 ${lat}, ${lon}`, 'gray');
    }
    updateMap(); // Importante: Actualizar mapa al tener coordenadas
}

async function smartSearch(query, container, input) {
    let found = await fetchSearch(query);
    
    // Cascada simple
    if (!found && query.includes(',')) {
        found = await fetchSearch(query.split(',').slice(0,2).join(','));
    }

    if (found) {
        const shortName = extractShortName(found);
        renderTag(container, "🏢 " + shortName, 'blue');
        // Guardamos COORDENADAS exactas para el mapa preview
        input.dataset.val = `${found.lat},${found.lon}`;
        updateMap();
    } else {
        renderTag(container, "⚠️ Texto original (Sin mapa previo)", 'gray');
        input.dataset.val = query;
        // No actualizamos mapa porque no tenemos coords
    }
}

function extractShortName(place) {
    const addr = place.address || {};
    const nameFields = ['amenity', 'shop', 'tourism', 'leisure', 'office', 'building', 'historic'];
    for (let field of nameFields) {
        if (addr[field]) return addr[field];
    }
    if (addr.road || addr.pedestrian) {
        let road = addr.road || addr.pedestrian;
        if (addr.house_number) return `${road}, ${addr.house_number}`;
        return road;
    }
    return place.display_name.split(',')[0];
}

async function fetchSearch(q) {
    try {
        const r = await fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(q)}&addressdetails=1&limit=1`);
        return (await r.json())[0];
    } catch(e) { return null; }
}

async function fetchReverse(lat, lon) {
    try {
        const r = await fetch(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lon}&addressdetails=1`);
        return await r.json();
    } catch(e) { return null; }
}

function renderTag(container, text, color) {
    container.innerHTML = `<div class="place-tag tag-${color}">${text}</div>`;
}

/* ==========================================
   GENERACIÓN DE URL (LÓGICA ORIGINAL)
   ========================================== */
function generate() {
    const inputs = document.querySelectorAll('input');
    const points = [];
    inputs.forEach(inp => {
        let val = inp.dataset.val || inp.value.trim();
        if(val) points.push(encodeURIComponent(val));
    });

    if(points.length < 2) { alert("Faltan puntos"); return; }

    const url = `https://www.google.com/maps/dir/?api=1&origin=${points[0]}&destination=${points[points.length-1]}` + 
                (points.length > 2 ? `&waypoints=${points.slice(1,-1).join('%7C')}` : '');

    const a = document.getElementById('final-link');
    document.getElementById('output').style.display = 'block';
    a.href = url;
    a.textContent = url;
}
