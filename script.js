/* ==========================================
   CONFIGURACIÓN Y ESTADO
   ========================================== */
let timeout = null;
let map = null;
let markers = []; 

document.addEventListener('DOMContentLoaded', () => {
    initMap();
    addStop(); 
    addStop(); 
});

/* ==========================================
   MAPA (LEAFLET)
   ========================================== */
function initMap() {
    map = L.map('map').setView([40.416, -3.703], 5);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '&copy; OpenStreetMap contributors'
    }).addTo(map);
}

function updateMap() {
    markers.forEach(m => map.removeLayer(m));
    markers = [];

    const inputs = document.querySelectorAll('input');
    const bounds = [];

    inputs.forEach((inp, index) => {
        const val = inp.dataset.coords; 
        
        if (val && val.includes(',')) {
            const [lat, lon] = val.split(',').map(Number);
            
            if (!isNaN(lat) && !isNaN(lon) && lat !== 0 && lon !== 0) {
                const isOrigin = index === 0;
                const isDest = index === inputs.length - 1;
                let color = '#3388ff';
                if (isOrigin) color = '#28a745';
                if (isDest) color = '#dc3545';

                const marker = L.circleMarker([lat, lon], {
                    color: '#fff', weight: 2, fillColor: color, fillOpacity: 1, radius: 8
                }).addTo(map);

                marker.bindPopup(`<b>${index === 0 ? "Origen" : (isDest ? "Destino" : "Parada " + index)}</b>`);
                markers.push(marker);
                bounds.push([lat, lon]);
            }
        }
    });

    if (bounds.length > 0) {
        map.fitBounds(bounds, { padding: [50, 50] });
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
            <input type="text" placeholder="URL Google Maps" oninput="handleInput(this)">
            <div class="details"></div>
        </div>
        <button class="btn-del" onclick="removeStop(this)" title="Borrar">×</button>
    `;
    list.appendChild(div);
    refreshLabels();
}

function removeStop(btn) {
    const list = document.getElementById('stops-list');
    if (list.children.length <= 2) { alert("Mínimo Origen y Destino"); return; }
    btn.closest('.stop-row').remove();
    refreshLabels();
    updateMap();
    generate();
}

function moveRow(btn, direction) {
    const row = btn.closest('.stop-row');
    const list = document.getElementById('stops-list');
    const items = [...list.children];
    const index = items.indexOf(row);
    if (direction === -1 && index > 0) list.insertBefore(row, items[index - 1]);
    else if (direction === 1 && index < items.length - 1) list.insertBefore(row, items[index + 1].nextSibling);
    refreshLabels();
    updateMap();
    generate();
}

function refreshLabels() {
    const rows = document.querySelectorAll('.stop-row');
    rows.forEach((row, i) => {
        const lbl = row.querySelector('.stop-label');
        if (i === 0) lbl.textContent = "🚩 Origen";
        else if (i === rows.length - 1) lbl.textContent = "🏁 Destino";
        else lbl.textContent = `Parada ${i}`;
    });
}

/* ==========================================
   LÓGICA DE EXTRACCIÓN (REGEX MEJORADA)
   ========================================== */
function handleInput(input) {
    const details = input.nextElementSibling;
    details.innerHTML = '';
    clearTimeout(timeout);
    
    const val = input.value.trim();
    if(!val) {
        delete input.dataset.val;
        delete input.dataset.coords;
        updateMap();
        return;
    }

    // --- ESCENARIO: URL DE GOOGLE MAPS ---
    if (val.includes('http') || val.includes('google.com') || val.includes('goo.gl')) {
        
        let extractedName = null;
        let extractedCoords = null;

        // 1. EXTRAER NOMBRE (Lógica Intacta)
        if (val.includes('/place/')) {
            const m = val.match(/\/place\/([^\/]+)/);
            if (m && m[1]) {
                extractedName = decodeURIComponent(m[1]).replace(/\+/g, ' ');
                if (extractedName.includes(',') && extractedName.length > 25) {
                    extractedName = extractedName.split(',')[0];
                }
            }
        }

        // 2. EXTRAER COORDENADAS (NUEVA REGEX MÁS PERMISIVA)
        // Busca !3d seguido de cualquier número (negativo o positivo)
        // Busca !4d seguido de cualquier número
        // Usamos matchAll para capturar todas las instancias y coger la última
        const allPins = [...val.matchAll(/!3d(-?\d+(?:\.\d+)?).*?!4d(-?\d+(?:\.\d+)?)/g)];
        
        if (allPins.length > 0) {
            // Cogemos siempre el ÚLTIMO par encontrado (destino final)
            const lastMatch = allPins[allPins.length - 1];
            extractedCoords = `${lastMatch[1]},${lastMatch[2]}`;
        } else {
            // PLAN B: Si falla !3d (URL rara), usamos @lat,lon (Cámara)
            const viewMatch = val.match(/@(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/);
            if (viewMatch) {
                extractedCoords = `${viewMatch[1]},${viewMatch[2]}`;
            }
        }

        // --- APLICACIÓN DE DATOS ---
        
        if (extractedName) {
            input.dataset.val = extractedName; 
            renderTag(details, "🏢 " + extractedName, 'blue');
            
            if (extractedCoords) {
                input.dataset.coords = extractedCoords; 
                updateMap();
            } else {
                fetchSearch(extractedName).then(found => {
                    if (found) {
                        input.dataset.coords = `${found.lat},${found.lon}`;
                        updateMap();
                    }
                });
            }
            return;
        }

        if (extractedCoords) {
            input.dataset.val = extractedCoords;
            input.dataset.coords = extractedCoords;
            updateMap();
            resolveLabelOnly(extractedCoords.split(',')[0], extractedCoords.split(',')[1], details);
            return;
        }

        input.dataset.val = val;
        renderTag(details, "🔗 Enlace Detectado", 'gray');
        return;
    }

    // --- ESCENARIO: TEXTO MANUAL ---
    details.innerHTML = '<span class="loading">🔍 Buscando...</span>';
    timeout = setTimeout(() => {
        smartSearch(val, details, input);
    }, 700);
}

// Helpers
async function resolveLabelOnly(lat, lon, container) {
    const data = await fetchReverse(lat, lon);
    if (data) {
        const name = extractShortName(data);
        renderTag(container, "📍 " + name, 'blue');
    } else {
        renderTag(container, `📍 ${lat}, ${lon}`, 'gray');
    }
}

async function smartSearch(query, container, input) {
    let found = await fetchSearch(query);
    if (!found && query.includes(',')) found = await fetchSearch(query.split(',').slice(0,2).join(','));

    if (found) {
        const shortName = extractShortName(found);
        renderTag(container, "🏢 " + shortName, 'blue');
        const c = `${found.lat},${found.lon}`;
        input.dataset.val = c;
        input.dataset.coords = c;
        updateMap();
    } else {
        renderTag(container, "⚠️ Texto original", 'gray');
        input.dataset.val = query;
    }
}

function extractShortName(place) {
    const addr = place.address || {};
    const f = ['amenity', 'shop', 'tourism', 'leisure', 'office', 'building'];
    for (let k of f) if (addr[k]) return addr[k];
    if (addr.road) return addr.house_number ? `${addr.road}, ${addr.house_number}` : addr.road;
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
function renderTag(c, t, color) { c.innerHTML = `<div class="place-tag tag-${color}">${t}</div>`; }

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
    a.href = url; a.textContent = url;
}
