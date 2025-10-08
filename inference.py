from ultralytics import YOLO
import os
import cv2
from datetime import datetime

class Model:
    def __init__(self, model_path):
        self.model_path = model_path
    
    def load_model(self):
        # Load the model from the specified path
        model = YOLO(self.model_path)
        return model
    
    def predict(self, model, image_path, output_dir="images/detections"):
        """
        Perform prediction on the image
        Returns: dict with detection results
        """
        # Create output directory if it doesn't exist
        os.makedirs(output_dir, exist_ok=True)
        
        # Run inference
        results = model(image_path, conf=0.25)  # confidence threshold
        
        # Get the first result (single image)
        result = results[0]
        
        # Extract detection information
        detections = []
        has_potholes = False
        
        if len(result.boxes) > 0:
            has_potholes = True
            for box in result.boxes:
                detections.append({
                    'confidence': float(box.conf[0]),
                    'class': int(box.cls[0]),
                    'class_name': result.names[int(box.cls[0])],
                    'bbox': box.xyxy[0].tolist()  # [x1, y1, x2, y2]
                })
        
        # Save annotated image
        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        output_filename = f"detected_{timestamp}.jpg"
        output_path = os.path.join(output_dir, output_filename)
        
        # Plot results and save
        annotated_img = result.plot()  # Get annotated image
        cv2.imwrite(output_path, annotated_img)
        
        return {
            'has_potholes': has_potholes,
            'num_detections': len(detections),
            'detections': detections,
            'output_image': output_path,
            'output_filename': output_filename
        }
        