from flask import Flask, request, jsonify, render_template, send_from_directory
import sqlite3
import math
import requests
import json
from datetime import datetime, timedelta
import polyline
import os
import glob
from flask_cors import CORS
from inference import Model

app = Flask(__name__)
CORS(app)

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
NOMINATIM_URL = "https://nominatim.openstreetmap.org/search?"
NOMINATIM_REVERSE_URL = "https://nominatim.openstreetmap.org/reverse"

# ============= IMAGE CLEANUP SETTINGS =============
CLEANUP_ENABLED = True  # Set to False to disable automatic cleanup
KEEP_IMAGES_DAYS = 0  # Keep images for this many days (0 = delete all during cleanup)
MAX_IMAGES_COUNT = 5  # Maximum number of images to keep
CLEANUP_ON_STARTUP = False  # Set to True to cleanup old images on app startup

def setup_database():
    conn = sqlite3.connect(os.path.join(BASE_DIR, 'locations.db'))
    cursor = conn.cursor()
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS pothole_detections (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            latitude REAL NOT NULL,
            longitude REAL NOT NULL,
            address TEXT,
            street TEXT,
            city TEXT,
            state TEXT,
            country TEXT,
            original_image TEXT,
            annotated_image TEXT,
            has_potholes BOOLEAN,
            num_detections INTEGER,
            max_confidence REAL,
            detections_json TEXT,
            timestamp TEXT,
            user_submitted BOOLEAN DEFAULT 1
        )
    ''')
    conn.commit()
    conn.close()
    try:
        os.mkdir(os.path.join(BASE_DIR, 'images'))
    except FileExistsError:
        pass

def cleanup_old_images(days=None, max_count=None):
    """
    Clean up old images to save disk space
    Args:
        days: Delete images older than this many days (default: KEEP_IMAGES_DAYS)
        max_count: Keep only this many most recent images (default: MAX_IMAGES_COUNT)
    Returns:
        dict with cleanup statistics
    """
    if days is None:
        days = KEEP_IMAGES_DAYS
    if max_count is None:
        max_count = MAX_IMAGES_COUNT
    
    stats = {
        'deleted_files': 0,
        'freed_space_mb': 0,
        'errors': []
    }
    
    try:
        # Get all image files
        upload_dir = os.path.join(BASE_DIR, 'images', 'uploads')
        detection_dir = os.path.join(BASE_DIR, 'images', 'detections')
        
        for directory in [upload_dir, detection_dir]:
            if not os.path.exists(directory):
                continue
            
            # Get all files with timestamps
            files = []
            for filename in os.listdir(directory):
                filepath = os.path.join(directory, filename)
                if os.path.isfile(filepath):
                    mtime = os.path.getmtime(filepath)
                    size = os.path.getsize(filepath)
                    files.append({
                        'path': filepath,
                        'mtime': mtime,
                        'size': size,
                        'filename': filename
                    })
            
            # Sort by modification time (oldest first)
            files.sort(key=lambda x: x['mtime'])
            
            # Delete old files (by date)
            cutoff_time = datetime.now() - timedelta(days=days)
            cutoff_timestamp = cutoff_time.timestamp()
            
            for file_info in files:
                if file_info['mtime'] < cutoff_timestamp:
                    try:
                        os.remove(file_info['path'])
                        stats['deleted_files'] += 1
                        stats['freed_space_mb'] += file_info['size'] / (1024 * 1024)
                    except Exception as e:
                        stats['errors'].append(f"Failed to delete {file_info['filename']}: {str(e)}")
            
            # Delete excess files (by count) - keep only most recent
            remaining_files = [f for f in files if os.path.exists(f['path'])]
            if len(remaining_files) > max_count:
                files_to_delete = remaining_files[:len(remaining_files) - max_count]
                for file_info in files_to_delete:
                    try:
                        os.remove(file_info['path'])
                        stats['deleted_files'] += 1
                        stats['freed_space_mb'] += file_info['size'] / (1024 * 1024)
                    except Exception as e:
                        stats['errors'].append(f"Failed to delete {file_info['filename']}: {str(e)}")
        
        # Round freed space
        stats['freed_space_mb'] = round(stats['freed_space_mb'], 2)
        
    except Exception as e:
        stats['errors'].append(f"Cleanup error: {str(e)}")
    
    return stats

def get_storage_info():
    """Get information about image storage usage"""
    info = {
        'total_files': 0,
        'total_size_mb': 0,
        'uploads': {'count': 0, 'size_mb': 0},
        'detections': {'count': 0, 'size_mb': 0}
    }
    
    try:
        upload_dir = os.path.join(BASE_DIR, 'images', 'uploads')
        detection_dir = os.path.join(BASE_DIR, 'images', 'detections')
        
        for directory, key in [(upload_dir, 'uploads'), (detection_dir, 'detections')]:
            if os.path.exists(directory):
                files = [f for f in os.listdir(directory) if os.path.isfile(os.path.join(directory, f))]
                total_size = sum(os.path.getsize(os.path.join(directory, f)) for f in files)
                
                info[key]['count'] = len(files)
                info[key]['size_mb'] = round(total_size / (1024 * 1024), 2)
                info['total_files'] += len(files)
                info['total_size_mb'] += info[key]['size_mb']
        
        info['total_size_mb'] = round(info['total_size_mb'], 2)
        
    except Exception as e:
        print(f"Storage info error: {e}")
    
    return info

def geocode_address(address):
    try:
        response = requests.get(
            NOMINATIM_URL,
            params={
                "q": address,
                "format": "json",
                "limit": 1
            },
            headers={"User-Agent": "PotholeApp"}
        )
        data = response.json()
        if data:
            return float(data[0]["lat"]), float(data[0]["lon"])
        return None, "No results found for address"
    except Exception as e:
        return None, str(e)

# Reverse geocode lat/lon to address
def reverse_geocode(lat, lon):
    try:
        response = requests.get(
            NOMINATIM_REVERSE_URL,
            params={
                "lat": lat,
                "lon": lon,
                "format": "json"
            },
            headers={"User-Agent": "PotholeApp"}
        )
        data = response.json()
        return data.get("display_name", "Unknown address")
    except:
        return "Unknown address"

def get_directions(origin, destination):
    try:
        origin_lon, origin_lat = map(float, origin.split(','))
        dest_lon, dest_lat = map(float, destination.split(','))

        if not (-90 <= origin_lat <= 90 and -180 <= origin_lon <= 180 and
                -90 <= dest_lat <= 90 and -180 <= dest_lon <= 180):
            return None, "Invalid coordinate values"

        if origin_lon == dest_lon and origin_lat == dest_lat:
            return {
                "distance": "0 km",
                "duration": "0 mins",
                "steps": [{"instruction": "No route needed (same location)", "distance": "0 km", "duration": "0 mins"}],
                "polyline": [[origin_lat, origin_lon]]
            }, None

        url = f"http://router.project-osrm.org/route/v1/driving/{origin};{destination}?overview=full&steps=true"
        response = requests.get(url, timeout=5)
        if response.status_code != 200:
            return None, f"OSRM request failed: HTTP {response.status_code}"

        data = response.json()
        if not isinstance(data, dict) or "code" not in data or data["code"] != "Ok":
            return None, f"OSRM error: {data.get('message', 'Unknown error')}"

        route = data["routes"][0]
        encoded_polyline = route["geometry"]
        decoded_coords = polyline.decode(encoded_polyline)
        polyline_coords = [[lat, lon] for lat, lon in decoded_coords]

        return {
            "distance": f"{route['distance']/1000:.1f} km",
            "duration": f"{route['duration']/60:.1f} mins",
            "steps": [
                {
                    "instruction": step["maneuver"].get("instruction", "Proceed"),
                    "distance": f"{step['distance']/1000:.1f} km",
                    "duration": f"{step['duration']/60:.1f} mins"
                } for step in route["legs"][0]["steps"]
            ],
            "polyline": polyline_coords
        }, None
    except ValueError:
        return None, "Invalid coordinate format"
    except requests.RequestException as e:
        return None, f"OSRM network error: {str(e)}"
    except Exception as e:
        return None, f"Routing error: {str(e)}"

# Initialize YOLO model (adjust path to your model)
model_instance = None

def get_model():
    global model_instance
    if model_instance is None:
        try:
            # Update this path to your actual YOLO model
            model_path = os.path.join(BASE_DIR , 'model.pt')  # Using your model.pt
            model_instance = Model(model_path)
            model_instance = model_instance.load_model()
        except Exception as e:
            print(f"Error loading model: {e}")
            return None
    return model_instance


# ============= ROUTES =============

@app.route('/')
def index():
    """Serve the main HTML page"""
    return render_template('index.html')


@app.route('/upload', methods=['POST'])
def upload_image():
    """
    Handle image upload and pothole detection
    Expects: multipart/form-data with 'image' file and optional 'latitude', 'longitude', 'address'
    Returns: JSON with detection results and annotated image URL
    """
    try:
        # Check if image file is present
        if 'image' not in request.files:
            return jsonify({'error': 'No image file provided'}), 400
        
        file = request.files['image']
        
        if file.filename == '':
            return jsonify({'error': 'No file selected'}), 400
        
        # Validate file type
        allowed_extensions = {'png', 'jpg', 'jpeg', 'gif', 'webp'}
        file_ext = file.filename.rsplit('.', 1)[1].lower() if '.' in file.filename else ''
        
        if file_ext not in allowed_extensions:
            return jsonify({'error': 'Invalid file type. Allowed: png, jpg, jpeg, gif, webp'}), 400
        
        # Save uploaded file
        upload_dir = os.path.join(BASE_DIR, 'images', 'uploads')
        os.makedirs(upload_dir, exist_ok=True)
        
        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        filename = f"upload_{timestamp}.{file_ext}"
        filepath = os.path.join(upload_dir, filename)
        file.save(filepath)
        
        # Load model and run detection
        model = get_model()
        if model is None:
            return jsonify({'error': 'Model failed to load'}), 500
        
        # Run YOLO inference
        from inference import Model as InferenceModel
        inference = InferenceModel(os.path.join(BASE_DIR, 'model.pt'))
        detection_results = inference.predict(model, filepath)
        
        # Get location data from request (optional for now)
        latitude = request.form.get('latitude', type=float)
        longitude = request.form.get('longitude', type=float)
        address = request.form.get('address', '')
        
        # Return results
        response_data = {
            'success': True,
            'uploaded_file': filename,
            'has_potholes': detection_results['has_potholes'],
            'num_detections': detection_results['num_detections'],
            'detections': detection_results['detections'],
            'annotated_image': f"/images/detections/{detection_results['output_filename']}",
            'original_image': f"/images/uploads/{filename}",
            'timestamp': timestamp
        }
        
        # If location provided, include it in response
        if latitude and longitude:
            response_data['latitude'] = latitude
            response_data['longitude'] = longitude
            response_data['address'] = address
        
        return jsonify(response_data), 200
        
    except Exception as e:
        print(f"Upload error: {e}")
        return jsonify({'error': f'Server error: {str(e)}'}), 500


@app.route('/images/<path:subpath>/<filename>')
def serve_image(subpath, filename):
    """Serve images from the images directory"""
    image_dir = os.path.join(BASE_DIR, 'images', subpath)
    return send_from_directory(image_dir, filename)


@app.route('/save-detection', methods=['POST'])
def save_detection():
    """
    Save pothole detection with location to database
    Expects JSON with detection data and location
    """
    try:
        data = request.get_json()
        
        # Validate required fields
        if not data.get('latitude') or not data.get('longitude'):
            return jsonify({'error': 'Latitude and longitude are required'}), 400
        
        latitude = float(data['latitude'])
        longitude = float(data['longitude'])
        
        # Get address from coordinates if not provided
        address = data.get('address', '')
        if not address:
            address = reverse_geocode(latitude, longitude)
        
        # Parse address components
        street = data.get('street', '')
        city = data.get('city', '')
        state = data.get('state', '')
        country = data.get('country', '')
        
        # Detection data
        has_potholes = data.get('has_potholes', False)
        num_detections = data.get('num_detections', 0)
        detections = data.get('detections', [])
        
        # Calculate max confidence
        max_confidence = 0.0
        if detections:
            max_confidence = max([d.get('confidence', 0.0) for d in detections])
        
        # Image paths
        original_image = data.get('original_image', '')
        annotated_image = data.get('annotated_image', '')
        
        # Save to database
        conn = sqlite3.connect(os.path.join(BASE_DIR, 'locations.db'))
        cursor = conn.cursor()
        
        cursor.execute('''
            INSERT INTO pothole_detections 
            (latitude, longitude, address, street, city, state, country,
             original_image, annotated_image, has_potholes, num_detections, 
             max_confidence, detections_json, timestamp, user_submitted)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ''', (
            latitude, longitude, address, street, city, state, country,
            original_image, annotated_image, has_potholes, num_detections,
            max_confidence, json.dumps(detections), 
            datetime.now().isoformat(), True
        ))
        
        detection_id = cursor.lastrowid
        conn.commit()
        conn.close()
        
        return jsonify({
            'success': True,
            'detection_id': detection_id,
            'message': 'Detection saved successfully'
        }), 200
        
    except Exception as e:
        print(f"Save detection error: {e}")
        return jsonify({'error': f'Server error: {str(e)}'}), 500


@app.route('/get-detections', methods=['GET'])
def get_detections():
    """
    Get all pothole detections from database
    Returns: JSON array of all detections
    """
    try:
        conn = sqlite3.connect(os.path.join(BASE_DIR, 'locations.db'))
        cursor = conn.cursor()
        
        cursor.execute('''
            SELECT id, latitude, longitude, address, street, city, state, country,
                   original_image, annotated_image, has_potholes, num_detections,
                   max_confidence, detections_json, timestamp
            FROM pothole_detections
            ORDER BY timestamp DESC
        ''')
        
        rows = cursor.fetchall()
        conn.close()
        
        detections = []
        for row in rows:
            detections.append({
                'id': row[0],
                'latitude': row[1],
                'longitude': row[2],
                'address': row[3],
                'street': row[4],
                'city': row[5],
                'state': row[6],
                'country': row[7],
                'original_image': row[8],
                'annotated_image': row[9],
                'has_potholes': bool(row[10]),
                'num_detections': row[11],
                'max_confidence': row[12],
                'detections': json.loads(row[13]) if row[13] else [],
                'timestamp': row[14]
            })
        
        return jsonify({'success': True, 'detections': detections}), 200
        
    except Exception as e:
        print(f"Get detections error: {e}")
        return jsonify({'error': f'Server error: {str(e)}'}), 500


@app.route('/find-route', methods=['POST'])
def find_route():
    """
    Calculate route and check for potholes along the way
    Expects JSON with origin and destination coordinates
    Returns route info with pothole warnings
    """
    try:
        data = request.get_json()
        
        origin_lat = data.get('origin_lat')
        origin_lon = data.get('origin_lon')
        dest_lat = data.get('dest_lat')
        dest_lon = data.get('dest_lon')
        
        if not all([origin_lat, origin_lon, dest_lat, dest_lon]):
            return jsonify({'error': 'Origin and destination coordinates required'}), 400
        
        # Get route using OSRM
        origin_coords = f"{origin_lon},{origin_lat}"
        dest_coords = f"{dest_lon},{dest_lat}"
        
        route_data, error = get_directions(origin_coords, dest_coords)
        
        if error:
            return jsonify({'error': error}), 400
        
        # Get all pothole detections from database
        conn = sqlite3.connect(os.path.join(BASE_DIR, 'locations.db'))
        cursor = conn.cursor()
        
        cursor.execute('''
            SELECT latitude, longitude, num_detections, max_confidence, address
            FROM pothole_detections
            WHERE has_potholes = 1
        ''')
        
        potholes = cursor.fetchall()
        conn.close()
        
        # Check if route passes near any potholes
        route_polyline = route_data['polyline']
        potholes_on_route = []
        danger_threshold = 0.001  # ~100 meters in degrees (approximate)
        
        for pothole in potholes:
            p_lat, p_lon, num_det, confidence, address = pothole
            
            # Check if pothole is near any point on the route
            for point in route_polyline:
                r_lat, r_lon = point
                distance = math.sqrt((p_lat - r_lat)**2 + (p_lon - r_lon)**2)
                
                if distance < danger_threshold:
                    potholes_on_route.append({
                        'latitude': p_lat,
                        'longitude': p_lon,
                        'num_detections': num_det,
                        'confidence': confidence,
                        'address': address,
                        'distance_from_route': distance * 111  # Convert to km (approximate)
                    })
                    break  # Found this pothole near route, no need to check other points
        
        # Calculate danger score
        danger_score = len(potholes_on_route)
        is_dangerous = danger_score > 0
        
        # Try to find alternative route if dangerous (using slightly different coordinates)
        alternative_route = None
        if is_dangerous:
            # Try waypoint-based alternative (simple approach)
            # In production, you'd use OSRM's alternative routes feature
            pass
        
        return jsonify({
            'success': True,
            'route': route_data,
            'potholes_on_route': potholes_on_route,
            'pothole_count': len(potholes_on_route),
            'is_dangerous': is_dangerous,
            'danger_score': danger_score,
            'warning': f"⚠️ {len(potholes_on_route)} pothole(s) detected along this route!" if is_dangerous else None
        }), 200
        
    except Exception as e:
        print(f"Route finding error: {e}")
        return jsonify({'error': f'Server error: {str(e)}'}), 500


@app.route('/storage-info', methods=['GET'])
def storage_info():
    """
    Get information about image storage usage
    Returns: Storage statistics
    """
    try:
        info = get_storage_info()
        return jsonify({'success': True, 'storage': info}), 200
    except Exception as e:
        print(f"Storage info error: {e}")
        return jsonify({'error': f'Server error: {str(e)}'}), 500


@app.route('/cleanup-images', methods=['POST'])
def cleanup_images():
    """
    Manually trigger image cleanup
    Expects JSON with optional 'days' and 'max_count' parameters
    Returns: Cleanup statistics
    """
    try:
        data = request.get_json() if request.is_json else {}
        
        days = data.get('days', KEEP_IMAGES_DAYS)
        max_count = data.get('max_count', MAX_IMAGES_COUNT)
        
        stats = cleanup_old_images(days=days, max_count=max_count)
        
        return jsonify({
            'success': True,
            'message': f"Cleanup complete! Deleted {stats['deleted_files']} files, freed {stats['freed_space_mb']} MB",
            'stats': stats
        }), 200
        
    except Exception as e:
        print(f"Cleanup error: {e}")
        return jsonify({'error': f'Server error: {str(e)}'}), 500


@app.route('/report-pothole', methods=['POST'])
def report_pothole():
    """
    Allow users to manually report a pothole at their current location
    Expects JSON with latitude and longitude
    Returns: Success message with detection ID
    """
    try:
        data = request.get_json()
        
        # Validate required fields
        if not data.get('latitude') or not data.get('longitude'):
            return jsonify({'error': 'Latitude and longitude are required'}), 400
        
        latitude = float(data['latitude'])
        longitude = float(data['longitude'])
        
        # Get address from coordinates
        address = reverse_geocode(latitude, longitude)
        
        # Save to database (user-reported, no image)
        conn = sqlite3.connect(os.path.join(BASE_DIR, 'locations.db'))
        cursor = conn.cursor()
        
        cursor.execute('''
            INSERT INTO pothole_detections 
            (latitude, longitude, address, street, city, state, country,
             original_image, annotated_image, has_potholes, num_detections, 
             max_confidence, detections_json, timestamp, user_submitted)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ''', (
            latitude, longitude, address, '', '', '', '',
            '', '', True, 1,  # has_potholes=True, num_detections=1 for user reports
            0.0, json.dumps([]), 
            datetime.now().isoformat(), True
        ))
        
        detection_id = cursor.lastrowid
        conn.commit()
        conn.close()
        
        return jsonify({
            'success': True,
            'detection_id': detection_id,
            'address': address,
            'message': 'Pothole reported successfully!'
        }), 200
        
    except Exception as e:
        print(f"Report pothole error: {e}")
        return jsonify({'error': f'Server error: {str(e)}'}), 500


@app.route('/geocode', methods=['POST'])
def geocode():
    """
    Convert address to coordinates
    Expects JSON with 'address' field
    Returns: JSON with latitude and longitude
    """
    try:
        data = request.get_json()
        address = data.get('address', '').strip()
        
        if not address:
            return jsonify({'error': 'Address is required'}), 400
        
        lat, lon = geocode_address(address)
        
        if lat is None:
            return jsonify({'error': lon or 'Could not geocode address'}), 400
        
        return jsonify({
            'success': True,
            'latitude': lat,
            'longitude': lon,
            'address': address
        }), 200
        
    except Exception as e:
        print(f"Geocode error: {e}")
        return jsonify({'error': f'Server error: {str(e)}'}), 500


# Initialize database on startup


# Optional: Run cleanup on startup
if CLEANUP_ON_STARTUP and CLEANUP_ENABLED:
    print("Running startup cleanup...")
    stats = cleanup_old_images()
    print(f"Startup cleanup: Deleted {stats['deleted_files']} files, freed {stats['freed_space_mb']} MB")

if __name__ == '__main__':
    setup_database()
    app.run(debug=True, host='0.0.0.0', port=5000)
