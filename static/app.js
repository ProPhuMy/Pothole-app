// --- Toggle sidebar (mobile) ---
const sidebar = document.getElementById('sidebar');
const toggleBtn = document.getElementById('toggleBtn');
toggleBtn.addEventListener('click', () => {
  sidebar.classList.toggle('open');
});

// --- Initialize map ---
const map = L.map('map').setView([10.7769, 106.7009], 12); 

L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
  attribution: '&copy; <a href="https://www.openstreetmap.org/">OpenStreetMap</a> contributors'
}).addTo(map);

let userLocationMarker = null;
let currentLocation = null; // Store current location {lat, lon, address}

// --- Map layers ---
let markerClusterGroup = L.markerClusterGroup();
let heatmapLayer = null;
let allDetections = [];
let individualMarkers = [];

// --- Statistics elements ---
const totalReportsEl = document.getElementById('totalReports');
const potholeCountEl = document.getElementById('potholeCount');
const cleanCountEl = document.getElementById('cleanCount');
const toggleHeatmapEl = document.getElementById('toggleHeatmap');
const toggleClusteringEl = document.getElementById('toggleClustering');

// --- Function to create marker icon ---
function createMarkerIcon(hasPotholes) {
  const color = hasPotholes ? '#d9534f' : '#5cb85c';
  return L.divIcon({
    html: `<div style="background-color: ${color}; width: 16px; height: 16px; border-radius: 50%; border: 3px solid white; box-shadow: 0 2px 4px rgba(0,0,0,0.3);"></div>`,
    className: 'custom-marker',
    iconSize: [16, 16],
    iconAnchor: [8, 8]
  });
}

// --- Function to load all detections ---
async function loadDetections() {
  try {
    const resp = await fetch('/get-detections');
    const data = await resp.json();
    
    if (data.success) {
      allDetections = data.detections;
      updateStatistics();
      displayMarkersOnMap();
    }
  } catch (err) {
    console.error('Failed to load detections:', err);
  }
}

// --- Update statistics ---
function updateStatistics() {
  const total = allDetections.length;
  const withPotholes = allDetections.filter(d => d.has_potholes).length;
  const clean = total - withPotholes;
  
  totalReportsEl.textContent = total;
  potholeCountEl.textContent = withPotholes;
  cleanCountEl.textContent = clean;
}

// --- Display markers on map ---
function displayMarkersOnMap() {
  // Clear existing markers
  markerClusterGroup.clearLayers();
  individualMarkers.forEach(m => map.removeLayer(m));
  individualMarkers = [];
  
  if (heatmapLayer) {
    map.removeLayer(heatmapLayer);
    heatmapLayer = null;
  }

  // Create markers for each detection
  allDetections.forEach(detection => {
    const marker = L.marker(
      [detection.latitude, detection.longitude],
      { icon: createMarkerIcon(detection.has_potholes) }
    );
    
    // Create popup content
    const popupContent = `
      <div style="min-width: 200px;">
        <strong style="color: ${detection.has_potholes ? '#d9534f' : '#5cb85c'};">
          ${detection.has_potholes ? '⚠️ Pothole Detected' : '✅ No Pothole'}
        </strong><br>
        <div style="font-size: 0.85rem; margin-top: 6px;">
          <strong>Detections:</strong> ${detection.num_detections}<br>
          ${detection.max_confidence ? `<strong>Confidence:</strong> ${(detection.max_confidence * 100).toFixed(1)}%<br>` : ''}
          <strong>Date:</strong> ${new Date(detection.timestamp).toLocaleString()}<br>
          ${detection.address ? `<strong>Location:</strong> ${detection.address}<br>` : ''}
          ${detection.annotated_image ? `<a href="${detection.annotated_image}" target="_blank">📷 View Image</a>` : ''}
        </div>
      </div>
    `;
    
    marker.bindPopup(popupContent);
    
    if (toggleClusteringEl.checked) {
      markerClusterGroup.addLayer(marker);
    } else {
      individualMarkers.push(marker);
      marker.addTo(map);
    }
  });

  // Add cluster group to map if clustering is enabled
  if (toggleClusteringEl.checked) {
    map.addLayer(markerClusterGroup);
  }

  // Create heatmap if enabled
  if (toggleHeatmapEl.checked) {
    createHeatmap();
  }
}

// --- Create heatmap ---
function createHeatmap() {
  const heatData = allDetections
    .filter(d => d.has_potholes)
    .map(d => [d.latitude, d.longitude, d.num_detections * 0.5]); // Intensity based on number of detections
  
  if (heatData.length > 0) {
    heatmapLayer = L.heatLayer(heatData, {
      radius: 25,
      blur: 15,
      maxZoom: 17,
      max: 1.0,
      gradient: {
        0.0: 'green',
        0.5: 'yellow',
        0.7: 'orange',
        1.0: 'red'
      }
    }).addTo(map);
  }
}

// --- Toggle heatmap ---
toggleHeatmapEl.addEventListener('change', () => {
  if (toggleHeatmapEl.checked) {
    createHeatmap();
  } else if (heatmapLayer) {
    map.removeLayer(heatmapLayer);
    heatmapLayer = null;
  }
});

// --- Toggle clustering ---
toggleClusteringEl.addEventListener('change', () => {
  displayMarkersOnMap();
});

// --- Load detections on page load ---
loadDetections();

// --- Location button logic ---
const locationBtn = document.getElementById('locationBtn');
const locationInfo = document.getElementById('locationInfo');
const locationText = document.getElementById('locationText');
const addressInput = document.getElementById('addressInput');

locationBtn.addEventListener('click', () => {
  if (navigator.geolocation) {
    locationBtn.disabled = true;
    locationBtn.textContent = "Getting location...";
    
    navigator.geolocation.getCurrentPosition(
      async pos => {
        const lat = pos.coords.latitude;
        const lon = pos.coords.longitude;
        map.setView([lat, lon], 13);
        
        // Remove old marker if exists
        if (userLocationMarker) {
          map.removeLayer(userLocationMarker);
        }
        
        // Add new marker
        userLocationMarker = L.marker([lat, lon]).addTo(map)
          .bindPopup("You are here")
          .openPopup();
        
        // Store location
        currentLocation = { lat, lon, address: `${lat.toFixed(6)}, ${lon.toFixed(6)}` };
        
        // Update UI
        locationInfo.style.display = 'block';
        locationText.textContent = `${lat.toFixed(6)}, ${lon.toFixed(6)}`;
        addressInput.value = '';
        
        locationBtn.disabled = false;
        locationBtn.textContent = "📍 Use My Location";
      },
      error => {
        alert("Could not get your location. Please check your browser permissions.");
        locationBtn.disabled = false;
        locationBtn.textContent = "📍 Use My Location";
      }
    );
  } else {
    alert("Geolocation is not supported by your browser.");
  }
});

// --- Report Pothole button logic ---
const reportPotholeBtn = document.getElementById('reportPotholeBtn');
const reportResult = document.getElementById('reportResult');

reportPotholeBtn.addEventListener('click', async () => {
  if (!currentLocation) {
    reportResult.innerHTML = '<span style="color: #ff6b6b;">⚠️ Please set your location first (use "Use My Location" button)</span>';
    return;
  }

  if (!confirm('Report a pothole at your current location?')) {
    return;
  }

  reportPotholeBtn.disabled = true;
  reportPotholeBtn.textContent = "Reporting...";
  reportResult.innerHTML = "📡 Sending report...";

  try {
    const response = await fetch('/report-pothole', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        latitude: currentLocation.lat,
        longitude: currentLocation.lon
      })
    });

    const data = await response.json();

    if (response.ok) {
      reportResult.innerHTML = `<span style="color: #28a745;">✅ ${data.message}</span><br><small style="color: #666;">${data.address}</small>`;
      
      // Reload detections to show the new report
      loadDetections();
      
      // Clear success message after 5 seconds
      setTimeout(() => {
        reportResult.innerHTML = '';
      }, 5000);
    } else {
      reportResult.innerHTML = `<span style="color: #ff6b6b;">❌ ${data.error}</span>`;
    }
  } catch (err) {
    console.error('Report error:', err);
    reportResult.innerHTML = '<span style="color: #ff6b6b;">❌ Failed to submit report</span>';
  } finally {
    reportPotholeBtn.disabled = false;
    reportPotholeBtn.textContent = "🕳️ Report Pothole Here";
  }
});

// Handle manual address input
addressInput.addEventListener('change', async (e) => {
  const address = e.target.value.trim();
  if (!address) {
    currentLocation = null;
    locationInfo.style.display = 'none';
    return;
  }

  // Check if it's coordinates (format: "lat, lon")
  const coordMatch = address.match(/^(-?\d+\.?\d*),\s*(-?\d+\.?\d*)$/);
  if (coordMatch) {
    const lat = parseFloat(coordMatch[1]);
    const lon = parseFloat(coordMatch[2]);
    
    if (lat >= -90 && lat <= 90 && lon >= -180 && lon <= 180) {
      currentLocation = { lat, lon, address };
      locationInfo.style.display = 'block';
      locationText.textContent = address;
      
      // Update map
      map.setView([lat, lon], 13);
      if (userLocationMarker) map.removeLayer(userLocationMarker);
      userLocationMarker = L.marker([lat, lon]).addTo(map)
        .bindPopup(address)
        .openPopup();
    } else {
      alert("Invalid coordinates. Latitude must be -90 to 90, longitude -180 to 180.");
    }
  } else {
    // It's an address - geocode it via backend
    try {
      locationInfo.style.display = 'block';
      locationText.textContent = "Geocoding address...";
      
      const response = await fetch('/geocode', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ address })
      });
      
      const data = await response.json();
      
      if (response.ok) {
        const lat = data.latitude;
        const lon = data.longitude;
        
        currentLocation = { lat, lon, address };
        locationInfo.style.display = 'block';
        locationText.textContent = `${address} (${lat.toFixed(6)}, ${lon.toFixed(6)})`;
        
        // Update map
        map.setView([lat, lon], 13);
        if (userLocationMarker) map.removeLayer(userLocationMarker);
        userLocationMarker = L.marker([lat, lon]).addTo(map)
          .bindPopup(address)
          .openPopup();
      } else {
        alert(`Could not find location: ${data.error}`);
        locationInfo.style.display = 'none';
        currentLocation = null;
      }
    } catch (err) {
      console.error('Geocoding error:', err);
      alert('Failed to geocode address. Please try again.');
      locationInfo.style.display = 'none';
      currentLocation = null;
    }
  }
});

// --- Upload logic ---
const fileInput = document.getElementById('fileInput');
const uploadBtn = document.getElementById('uploadBtn');
const resultDiv = document.getElementById('result');
const previewImg = document.getElementById('preview');
let selectedFile = null;

fileInput.addEventListener('change', (e) => {
  const f = e.target.files[0];
  if (!f) return;
  selectedFile = f;
  const url = URL.createObjectURL(f);
  previewImg.src = url;
  previewImg.style.display = 'block';
  resultDiv.textContent = "";
});

uploadBtn.addEventListener('click', async () => {
  if (!selectedFile) {
    resultDiv.textContent = "Pick an image file first.";
    return;
  }
  
  const fd = new FormData();
  fd.append('image', selectedFile);
  
  // Add location if available
  if (currentLocation) {
    if (currentLocation.lat && currentLocation.lon) {
      fd.append('latitude', currentLocation.lat);
      fd.append('longitude', currentLocation.lon);
    }
    if (currentLocation.address) {
      fd.append('address', currentLocation.address);
    }
  }

  uploadBtn.disabled = true;
  uploadBtn.textContent = "Analyzing...";
  resultDiv.innerHTML = "🔍 Detecting potholes...";

  try {
    const resp = await fetch('/upload', { method: 'POST', body: fd });
    const data = await resp.json();
    
    if (!resp.ok) {
      resultDiv.innerHTML = `<span style="color:crimson">❌ Upload failed: ${data.error || resp.statusText}</span>`;
    } else {
      // Display detection results
      if (data.has_potholes) {
        resultDiv.innerHTML = `
          <div style="color: #d9534f; font-weight: bold;">
            ⚠️ ${data.num_detections} Pothole(s) Detected!
          </div>
          <div style="font-size: 0.85rem; margin-top: 4px;">
            ${data.detections.map(d => 
              `• ${d.class_name}: ${(d.confidence * 100).toFixed(1)}% confidence`
            ).join('<br>')}
          </div>
        `;
        // Show annotated image with bounding boxes
        previewImg.src = data.annotated_image;
      } else {
        resultDiv.innerHTML = `
          <div style="color: #5cb85c; font-weight: bold;">
            ✅ No Potholes Detected
          </div>
          <div style="font-size: 0.85rem; margin-top: 4px;">
            Road appears to be in good condition
          </div>
        `;
      }
      
      // Save detection to database if location is available
      if (currentLocation && (currentLocation.lat || currentLocation.address)) {
        try {
          const saveData = {
            has_potholes: data.has_potholes,
            num_detections: data.num_detections,
            detections: data.detections,
            original_image: data.original_image,
            annotated_image: data.annotated_image
          };
          
          // Add location data
          if (currentLocation.lat && currentLocation.lon) {
            saveData.latitude = currentLocation.lat;
            saveData.longitude = currentLocation.lon;
          }
          if (currentLocation.address) {
            saveData.address = currentLocation.address;
          }
          
          const saveResp = await fetch('/save-detection', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(saveData)
          });
          
          if (saveResp.ok) {
            const saveResult = await saveResp.json();
            resultDiv.innerHTML += `<div style="font-size: 0.85rem; margin-top: 8px; color: #28a745;">💾 Saved to database (ID: ${saveResult.detection_id})</div>`;
            
            // Reload all detections to update map and statistics
            await loadDetections();
          }
        } catch (saveErr) {
          console.error('Failed to save detection:', saveErr);
        }
      }
    }
  } catch (err) {
    console.error(err);
    resultDiv.innerHTML = `<span style="color:crimson">❌ Network error</span>`;
  } finally {
    uploadBtn.disabled = false;
    uploadBtn.textContent = "Upload & Detect";
  }
});

// ============= ROUTING FUNCTIONALITY =============

const originInput = document.getElementById('originInput');
const destinationInput = document.getElementById('destinationInput');
const findRouteBtn = document.getElementById('findRouteBtn');
const clearRouteBtn = document.getElementById('clearRouteBtn');
const routeResult = document.getElementById('routeResult');
const mapClickBtn = document.getElementById('mapClickBtn');
const mapClickStatus = document.getElementById('mapClickStatus');
const clickStatusText = document.getElementById('clickStatusText');

let routeLayer = null;
let routePotholeMarkers = [];

// Map clicking state
let mapClickMode = false;
let clickOriginSet = false;
let clickDestinationSet = false;
let tempOriginMarker = null;
let tempDestMarker = null;
let routeOriginMarker = null;
let routeDestMarker = null;

// Helper function to parse location input (address or coordinates)
async function parseLocation(input) {
  const coordMatch = input.match(/^(-?\d+\.?\d*),\s*(-?\d+\.?\d*)$/);
  if (coordMatch) {
    return {
      lat: parseFloat(coordMatch[1]),
      lon: parseFloat(coordMatch[2])
    };
  }
  
  // If not coordinates, assume it's an address - geocode it
  try {
    const response = await fetch(`https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(input)}&format=json&limit=1`, {
      headers: { 'User-Agent': 'PotholeDetectionApp' }
    });
    const data = await response.json();
    if (data && data.length > 0) {
      return {
        lat: parseFloat(data[0].lat),
        lon: parseFloat(data[0].lon)
      };
    }
  } catch (err) {
    console.error('Geocoding error:', err);
  }
  
  return null;
}

// Map click mode toggle
mapClickBtn.addEventListener('click', () => {
  mapClickMode = !mapClickMode;
  
  if (mapClickMode) {
    // Enable map click mode
    mapClickBtn.style.background = '#28a745';
    mapClickBtn.textContent = '✅ Click Mode Active';
    mapClickStatus.style.display = 'block';
    clickStatusText.textContent = '🎯 Click on map to set origin';
    clickOriginSet = false;
    clickDestinationSet = false;
    
    // Change cursor to crosshair
    document.getElementById('map').style.cursor = 'crosshair';
  } else {
    // Disable map click mode
    mapClickBtn.style.background = '#17a2b8';
    mapClickBtn.textContent = '📍 Click Map to Set Points';
    mapClickStatus.style.display = 'none';
    clickOriginSet = false;
    clickDestinationSet = false;
    
    // Reset cursor
    document.getElementById('map').style.cursor = '';
  }
});

// Handle map clicks for route selection
map.on('click', (e) => {
  if (!mapClickMode) return;
  
  const lat = e.latlng.lat;
  const lon = e.latlng.lng;
  
  if (!clickOriginSet) {
    // Set origin
    originInput.value = `${lat.toFixed(6)}, ${lon.toFixed(6)}`;
    
    // Remove old marker if exists
    if (tempOriginMarker) {
      map.removeLayer(tempOriginMarker);
    }
    
    // Add origin marker
    tempOriginMarker = L.marker([lat, lon], {
      icon: L.divIcon({
        html: '<div style="background-color: #28a745; width: 20px; height: 20px; border-radius: 50%; border: 3px solid white; box-shadow: 0 2px 6px rgba(0,0,0,0.4); display: flex; align-items: center; justify-content: center; color: white; font-size: 12px; font-weight: bold;">A</div>',
        className: 'custom-origin-marker',
        iconSize: [20, 20],
        iconAnchor: [10, 10]
      })
    }).addTo(map);
    
    tempOriginMarker.bindPopup('🚩 Origin').openPopup();
    
    clickOriginSet = true;
    clickStatusText.textContent = '🎯 Now click on map to set destination';
    
  } else if (!clickDestinationSet) {
    // Set destination
    destinationInput.value = `${lat.toFixed(6)}, ${lon.toFixed(6)}`;
    
    // Remove old marker if exists
    if (tempDestMarker) {
      map.removeLayer(tempDestMarker);
    }
    
    // Add destination marker
    tempDestMarker = L.marker([lat, lon], {
      icon: L.divIcon({
        html: '<div style="background-color: #dc3545; width: 20px; height: 20px; border-radius: 50%; border: 3px solid white; box-shadow: 0 2px 6px rgba(0,0,0,0.4); display: flex; align-items: center; justify-content: center; color: white; font-size: 12px; font-weight: bold;">B</div>',
        className: 'custom-dest-marker',
        iconSize: [20, 20],
        iconAnchor: [10, 10]
      })
    }).addTo(map);
    
    tempDestMarker.bindPopup('🏁 Destination').openPopup();
    
    clickDestinationSet = true;
    clickStatusText.textContent = '✅ Origin & Destination set! Click "Find Route"';
    
    // Disable map click mode
    mapClickMode = false;
    mapClickBtn.style.background = '#17a2b8';
    mapClickBtn.textContent = '📍 Click Map to Set Points';
    document.getElementById('map').style.cursor = '';
    
    // Auto-hide status after 3 seconds
    setTimeout(() => {
      mapClickStatus.style.display = 'none';
    }, 3000);
  }
});

// Find route button handler
findRouteBtn.addEventListener('click', async () => {
  const originText = originInput.value.trim();
  const destText = destinationInput.value.trim();
  
  if (!originText || !destText) {
    routeResult.innerHTML = '<span style="color: crimson;">⚠️ Please enter both origin and destination</span>';
    return;
  }
  
  findRouteBtn.disabled = true;
  findRouteBtn.textContent = "Calculating...";
  routeResult.innerHTML = "🔍 Finding route...";
  
  try {
    // Parse locations
    const origin = await parseLocation(originText);
    const destination = await parseLocation(destText);
    
    if (!origin || !destination) {
      routeResult.innerHTML = '<span style="color: crimson;">❌ Could not find one or both locations</span>';
      findRouteBtn.disabled = false;
      findRouteBtn.textContent = "🗺️ Find Route";
      return;
    }
    
    // Call backend to find route
    const response = await fetch('/find-route', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        origin_lat: origin.lat,
        origin_lon: origin.lon,
        dest_lat: destination.lat,
        dest_lon: destination.lon
      })
    });
    
    const data = await response.json();
    
    if (!response.ok) {
      routeResult.innerHTML = `<span style="color: crimson;">❌ ${data.error}</span>`;
      findRouteBtn.disabled = false;
      findRouteBtn.textContent = "🗺️ Find Route";
      return;
    }
    
    // Display route on map
    if (routeLayer) {
      map.removeLayer(routeLayer);
    }
    
    routeLayer = L.polyline(data.route.polyline, {
      color: data.is_dangerous ? '#d9534f' : '#5cb85c',
      weight: 5,
      opacity: 0.7
    }).addTo(map);
    
    // Fit map to show entire route
    map.fitBounds(routeLayer.getBounds(), { padding: [50, 50] });
    
    // Remove old route markers if they exist
    if (routeOriginMarker) map.removeLayer(routeOriginMarker);
    if (routeDestMarker) map.removeLayer(routeDestMarker);
    
    // Add markers for origin and destination
    routeOriginMarker = L.marker([origin.lat, origin.lon])
      .addTo(map)
      .bindPopup('🚩 Origin')
      .openPopup();
    
    routeDestMarker = L.marker([destination.lat, destination.lon])
      .addTo(map)
      .bindPopup('🏁 Destination');
    
    // Mark potholes along route
    routePotholeMarkers.forEach(m => map.removeLayer(m));
    routePotholeMarkers = [];
    
    data.potholes_on_route.forEach(pothole => {
      const marker = L.circleMarker([pothole.latitude, pothole.longitude], {
        radius: 10,
        fillColor: '#ff4444',
        color: '#fff',
        weight: 2,
        opacity: 1,
        fillOpacity: 0.8
      }).addTo(map);
      
      marker.bindPopup(`
        <strong style="color: #d9534f;">⚠️ Pothole on Route</strong><br>
        <strong>Detections:</strong> ${pothole.num_detections}<br>
        ${pothole.confidence ? `<strong>Confidence:</strong> ${(pothole.confidence * 100).toFixed(1)}%<br>` : ''}
        ${pothole.address ? `<strong>Location:</strong> ${pothole.address}` : ''}
      `);
      
      routePotholeMarkers.push(marker);
    });
    
    // Display route information
    let resultHTML = `
      <div style="padding: 10px; background: ${data.is_dangerous ? '#fff3cd' : '#d4edda'}; border-radius: 6px; margin-top: 8px; border-left: 4px solid ${data.is_dangerous ? '#ffc107' : '#28a745'};">
        <div style="font-weight: bold; margin-bottom: 6px;">
          ${data.is_dangerous ? '⚠️ Warning: Potholes Detected!' : '✅ Route Looks Clear'}
        </div>
        <div style="font-size: 0.85rem;">
          📏 Distance: <strong>${data.route.distance}</strong><br>
          ⏱️ Duration: <strong>${data.route.duration}</strong><br>
          🕳️ Potholes on route: <strong>${data.pothole_count}</strong>
        </div>
    `;
    
    if (data.is_dangerous) {
      resultHTML += `
        <div style="margin-top: 8px; padding: 8px; background: white; border-radius: 4px; font-size: 0.85rem;">
          <strong>Pothole Locations:</strong><br>
          ${data.potholes_on_route.map((p, i) => 
            `${i + 1}. ${p.address || 'Unknown location'} (${p.num_detections} detection${p.num_detections > 1 ? 's' : ''})`
          ).join('<br>')}
        </div>
        <div style="margin-top: 8px; font-size: 0.8rem; color: #856404;">
          💡 Tip: Consider alternative routes or drive carefully through marked areas.
        </div>
      `;
    }
    
    resultHTML += '</div>';
    routeResult.innerHTML = resultHTML;
    
    // Show clear button
    clearRouteBtn.style.display = 'block';
    
  } catch (err) {
    console.error('Route error:', err);
    routeResult.innerHTML = '<span style="color: crimson;">❌ Failed to calculate route</span>';
  } finally {
    findRouteBtn.disabled = false;
    findRouteBtn.textContent = "🗺️ Find Route";
  }
});

// Clear route button handler
clearRouteBtn.addEventListener('click', () => {
  if (routeLayer) {
    map.removeLayer(routeLayer);
    routeLayer = null;
  }
  
  routePotholeMarkers.forEach(m => map.removeLayer(m));
  routePotholeMarkers = [];
  
  // Clear temporary markers (from map clicking)
  if (tempOriginMarker) {
    map.removeLayer(tempOriginMarker);
    tempOriginMarker = null;
  }
  if (tempDestMarker) {
    map.removeLayer(tempDestMarker);
    tempDestMarker = null;
  }
  
  // Clear route markers (from Find Route)
  if (routeOriginMarker) {
    map.removeLayer(routeOriginMarker);
    routeOriginMarker = null;
  }
  if (routeDestMarker) {
    map.removeLayer(routeDestMarker);
    routeDestMarker = null;
  }
  
  routeResult.innerHTML = '';
  clearRouteBtn.style.display = 'none';
  originInput.value = '';
  destinationInput.value = '';
  
  // Reset click mode states
  mapClickMode = false;
  clickOriginSet = false;
  clickDestinationSet = false;
  mapClickBtn.style.background = '#17a2b8';
  mapClickBtn.textContent = '📍 Click Map to Set Points';
  mapClickStatus.style.display = 'none';
  document.getElementById('map').style.cursor = '';
  
  // Reset map view
  map.setView([10.7769, 106.7009], 12);
});

// ============= STORAGE MANAGEMENT =============

const totalFilesEl = document.getElementById('totalFiles');
const totalSizeEl = document.getElementById('totalSize');
const refreshStorageBtn = document.getElementById('refreshStorageBtn');
const cleanupBtn = document.getElementById('cleanupBtn');
const cleanupResult = document.getElementById('cleanupResult');

// Function to load storage info
async function loadStorageInfo() {
  try {
    const resp = await fetch('/storage-info');
    const data = await resp.json();
    
    if (data.success) {
      totalFilesEl.textContent = data.storage.total_files;
      totalSizeEl.textContent = data.storage.total_size_mb;
      
      // Update button color based on storage usage
      if (data.storage.total_size_mb > 500) {
        cleanupBtn.style.background = '#dc3545'; // Red if over 500MB
      } else if (data.storage.total_size_mb > 200) {
        cleanupBtn.style.background = '#ffc107'; // Yellow if over 200MB
      } else {
        cleanupBtn.style.background = '#28a745'; // Green if under 200MB
      }
    }
  } catch (err) {
    console.error('Failed to load storage info:', err);
  }
}

// Refresh storage info button
refreshStorageBtn.addEventListener('click', async () => {
  refreshStorageBtn.disabled = true;
  refreshStorageBtn.textContent = '⏳ Loading...';
  
  await loadStorageInfo();
  
  refreshStorageBtn.disabled = false;
  refreshStorageBtn.textContent = '🔄 Refresh Info';
});

// Cleanup button handler
cleanupBtn.addEventListener('click', async () => {
  if (!confirm('⚠️ This will delete old images (older than 30 days) to free up space. Continue?')) {
    return;
  }
  
  cleanupBtn.disabled = true;
  cleanupBtn.textContent = '🧹 Cleaning...';
  cleanupResult.innerHTML = '<span style="color: #666;">Cleaning up old images...</span>';
  
  try {
    const resp = await fetch('/cleanup-images', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({})
    });
    
    const data = await resp.json();
    
    if (data.success) {
      cleanupResult.innerHTML = `
        <div style="color: #28a745; background: #d4edda; padding: 8px; border-radius: 4px; margin-top: 8px;">
          ✅ ${data.message}<br>
          <span style="font-size: 0.8rem;">
            Deleted: ${data.stats.deleted_files} files<br>
            Freed: ${data.stats.freed_space_mb} MB
          </span>
        </div>
      `;
      
      // Refresh storage info after cleanup
      await loadStorageInfo();
      
      // Clear message after 10 seconds
      setTimeout(() => {
        cleanupResult.innerHTML = '';
      }, 10000);
    } else {
      cleanupResult.innerHTML = `<span style="color: crimson;">❌ Cleanup failed: ${data.error}</span>`;
    }
  } catch (err) {
    console.error('Cleanup error:', err);
    cleanupResult.innerHTML = '<span style="color: crimson;">❌ Network error</span>';
  } finally {
    cleanupBtn.disabled = false;
    cleanupBtn.textContent = '🧹 Cleanup Old Images';
  }
});

// Load storage info on page load
loadStorageInfo();
