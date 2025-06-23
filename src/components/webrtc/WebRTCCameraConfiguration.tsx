import React, { useState, useEffect, useRef, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { 
  Camera, 
  Plus, 
  X, 
  Video, 
  VideoOff, 
  RefreshCw, 
  Wifi, 
  WifiOff,
  Activity
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { webRTCManager } from "@/utils/webrtc/WebRTCManager";
import { UnifiedCameraSource, CameraQuality, CAMERA_CONSTRAINTS } from "@/types/webrtc";
import { useApi } from "@/contexts/ApiContext";

// Legacy interface for compatibility  
export interface CameraConfig {
  id: string;
  name: string;
  type: string;
  camera_index?: number;
  device_id: string;
  width: number;
  height: number;
  fps?: number;
}

interface WebRTCCameraConfigurationProps {
  cameras: CameraConfig[];
  onCamerasChange: (cameras: CameraConfig[]) => void;
  releaseStreamsRef?: React.MutableRefObject<(() => void) | null>;
  loadSavedCameras?: boolean;
}

interface DetectedCamera {
  index: number;
  deviceId: string;
  name: string;
  available: boolean;
}

const WebRTCCameraConfiguration: React.FC<WebRTCCameraConfigurationProps> = ({
  cameras,
  onCamerasChange,
  releaseStreamsRef,
  loadSavedCameras = true,
}) => {
  const { baseUrl, fetchWithHeaders } = useApi();
  const { toast } = useToast();

  // WebRTC state
  const [webrtcSources, setWebrtcSources] = useState<UnifiedCameraSource[]>([]);
  const [isConnectedToSignaling, setIsConnectedToSignaling] = useState(false);
  const [signalingStats, setSignalingStats] = useState<any>(null);

  // Camera detection state
  const [detectedCameras, setDetectedCameras] = useState<DetectedCamera[]>([]);
  const [selectedCameraIndex, setSelectedCameraIndex] = useState<string>("");
  const [cameraName, setCameraName] = useState("");
  // Removed selectedQuality - will be configurable per camera after adding
  const [isLoadingCameras, setIsLoadingCameras] = useState(false);

  // WebRTC video elements refs
  const videoRefs = useRef<Map<string, HTMLVideoElement>>(new Map());

  // WebRTC event handlers (with useCallback to maintain references)
  const handleCameraAdded = useCallback((source: UnifiedCameraSource) => {
    console.log("📹 Camera added to WebRTC:", source.name);
    setWebrtcSources(prev => [...prev.filter(s => s.id !== source.id), source]);
  }, []);

  const handleCameraRemoved = useCallback((sourceId: string) => {
    console.log("🗑️ Camera removed from WebRTC:", sourceId);
    setWebrtcSources(prev => prev.filter(s => s.id !== sourceId));
    
    // Remove video element ref
    const videoElement = videoRefs.current.get(sourceId);
    if (videoElement) {
      videoElement.srcObject = null;
      videoRefs.current.delete(sourceId);
    }
  }, []);

  const handleCameraConnected = useCallback((sourceId: string, stream: MediaStream) => {
    console.log("✅ Camera connected:", sourceId);
    
    // Update source status
    setWebrtcSources(prev => prev.map(source => 
      source.id === sourceId 
        ? { ...source, status: 'connected', stream }
        : source
    ));

    // Attach stream to video element
    const videoElement = videoRefs.current.get(sourceId);
    if (videoElement && stream) {
      videoElement.srcObject = stream;
      videoElement.play().catch(console.error);
    }
  }, []);

  const handleCameraDisconnected = useCallback((sourceId: string) => {
    console.log("🔌 Camera disconnected:", sourceId);
    setWebrtcSources(prev => prev.map(source => 
      source.id === sourceId 
        ? { ...source, status: 'disconnected', stream: undefined }
        : source
    ));
  }, []);

  const handleCameraError = useCallback((sourceId: string, error: Error) => {
    console.error("❌ Camera error:", sourceId, error);
    toast({
      title: "Camera Error",
      description: `Error with camera ${sourceId}: ${error.message}`,
      variant: "destructive",
    });
  }, [toast]);

  const handleCameraUpdated = useCallback((sourceId: string, updatedSource: UnifiedCameraSource) => {
    console.log("🔄 Camera updated in WebRTC manager:", sourceId);
    setWebrtcSources(prev => prev.map(s => 
      s.id === sourceId ? updatedSource : s
    ));
  }, []);

  const fetchSignalingStats = useCallback(async () => {
    try {
      const response = await fetchWithHeaders(`${baseUrl}/webrtc/status`);
      const data = await response.json();
      setSignalingStats(data.stats);
    } catch (error) {
      console.error("Error fetching signaling stats:", error);
    }
  }, [baseUrl, fetchWithHeaders]);

  const handleWebRTCConnected = useCallback(() => {
    console.log("✅ Connected to WebRTC signaling server");
    setIsConnectedToSignaling(true);
    fetchSignalingStats();
  }, [fetchSignalingStats]);

  const handleWebRTCDisconnected = useCallback(() => {
    console.log("🔌 Disconnected from WebRTC signaling server");
    setIsConnectedToSignaling(false);
  }, []);

  // Initialize WebRTC Manager
  useEffect(() => {
    const initializeWebRTC = async () => {
      try {
        console.log("🚀 Initializing WebRTC Manager...");
        
        // Configure WebRTC manager
        webRTCManager.config.signalingUrl = `${baseUrl.replace('http', 'ws')}/ws/webrtc`;
        
        // Setup event listeners
        webRTCManager.on('camera-added', handleCameraAdded);
        webRTCManager.on('camera-removed', handleCameraRemoved);
        webRTCManager.on('camera-connected', handleCameraConnected);
        webRTCManager.on('camera-disconnected', handleCameraDisconnected);
        webRTCManager.on('camera-error', handleCameraError);
        webRTCManager.on('camera-updated', handleCameraUpdated);
        webRTCManager.on('connected', handleWebRTCConnected);
        webRTCManager.on('disconnected', handleWebRTCDisconnected);

        // Connect to signaling server if not already connected
        if (!webRTCManager.isConnectedToSignaling()) {
          console.log("🔗 Connecting to signaling server...");
          await webRTCManager.connect();
        } else {
          console.log("✅ Already connected to signaling server");
          // Set the connected state even if already connected
          setIsConnectedToSignaling(true);
          fetchSignalingStats();
        }
        
        // Load saved cameras if requested and no cameras exist yet
        if (loadSavedCameras && webRTCManager.getAllCameras().length === 0) {
          console.log("📂 No existing cameras, loading saved configurations...");
          await loadSavedCameraConfigs();
        } else if (loadSavedCameras) {
          console.log("📂 Cameras already exist, skipping saved camera load");
          // Load existing cameras into local state
          const existingCameras = webRTCManager.getAllCameras();
          console.log("📹 Loading existing cameras into state:", existingCameras.length);
          setWebrtcSources([...existingCameras]);
        }
        
    } catch (error) {
        console.error("❌ Failed to initialize WebRTC:", error);
        toast({
          title: "WebRTC Initialization Failed",
          description: "Could not connect to WebRTC signaling server.",
          variant: "destructive",
        });
      }
    };

    initializeWebRTC();

    // Cleanup on unmount
    return () => {
      // Only remove our specific listeners using the function references
      webRTCManager.off('camera-added', handleCameraAdded);
      webRTCManager.off('camera-removed', handleCameraRemoved);
      webRTCManager.off('camera-connected', handleCameraConnected);
      webRTCManager.off('camera-disconnected', handleCameraDisconnected);
      webRTCManager.off('camera-error', handleCameraError);
      webRTCManager.off('camera-updated', handleCameraUpdated);
      
      // Also remove our connection listeners specifically
      webRTCManager.off('connected', handleWebRTCConnected);
      webRTCManager.off('disconnected', handleWebRTCDisconnected);
      
      // Don't disconnect WebRTC manager as teleoperation might need it
    };
  }, [baseUrl, loadSavedCameras, handleCameraAdded, handleCameraRemoved, handleCameraConnected, handleCameraDisconnected, handleCameraError, handleCameraUpdated, handleWebRTCConnected, handleWebRTCDisconnected]);

  // Sync WebRTC sources to parent component
  const syncToParent = useCallback(() => {
    const legacyConfigs: CameraConfig[] = webrtcSources
      .filter(source => source.status === 'connected')
      .map(source => ({
        id: source.id,
        name: source.name,
        type: "webrtc",
        device_id: source.deviceId || source.id,
        width: source.width,
        height: source.height,
        fps: source.fps,
      }));

    console.log("🔄 Syncing WebRTC cameras to parent:", legacyConfigs);
    onCamerasChange(legacyConfigs);
  }, [webrtcSources, onCamerasChange]);

  // Update parent when sources change
  useEffect(() => {
    syncToParent();
  }, [syncToParent]);

  // Camera detection
  const detectAvailableCameras = async () => {
    console.log("🔍 Detecting available cameras...");
    setIsLoadingCameras(true);
    
    try {
      // First enumeration (might show limited devices)
      let devices = await navigator.mediaDevices.enumerateDevices();
      console.log("📹 Initial device enumeration:", devices.filter(d => d.kind === "videoinput"));

      // Request camera permissions to unlock full device list
      const tempStream = await navigator.mediaDevices.getUserMedia({ 
        video: { 
          facingMode: { ideal: "user" } // This helps detect iPhone Continuity cameras
        } 
      });
      tempStream.getTracks().forEach(track => track.stop());

      // Wait a bit for system to register all cameras
      await new Promise(resolve => setTimeout(resolve, 500));

      // Re-enumerate devices after permissions granted
      devices = await navigator.mediaDevices.enumerateDevices();
      const videoDevices = devices.filter(device => device.kind === "videoinput");
      
      console.log("📹 Final device enumeration:", videoDevices);

      const detected = videoDevices.map((device, index) => ({
        index,
        deviceId: device.deviceId,
        name: device.label || `Camera ${index + 1}`,
        available: true,
      }));

      setDetectedCameras(detected);
      console.log("✅ Detected cameras:", detected);
      
    } catch (error) {
      console.error("❌ Camera detection failed:", error);
      toast({
        title: "Camera Detection Failed",
        description: "Could not detect cameras. Please check permissions.",
        variant: "destructive",
      });
    } finally {
      setIsLoadingCameras(false);
    }
  };

  // Add camera to WebRTC system
  const addCamera = async () => {
    if (!selectedCameraIndex || !cameraName.trim()) {
      toast({
        title: "Missing Information",
        description: "Please select a camera and provide a name.",
        variant: "destructive",
      });
      return;
    }

    if (!isConnectedToSignaling) {
      toast({
        title: "Not Connected",
        description: "Not connected to WebRTC signaling server.",
        variant: "destructive",
      });
      return;
    }

    const cameraIndex = parseInt(selectedCameraIndex);
    const selectedCamera = detectedCameras.find(cam => cam.index === cameraIndex);

    if (!selectedCamera) {
      toast({
        title: "Invalid Camera",
        description: "Selected camera is not available.",
        variant: "destructive",
      });
      return;
    }

    // Check if camera already added (check both local state and WebRTC manager)
    const isDuplicateInLocal = webrtcSources.some(source => source.deviceId === selectedCamera.deviceId);
    const isDuplicateInManager = webRTCManager.getAllCameras().some(source => source.deviceId === selectedCamera.deviceId);
    
    if (isDuplicateInLocal || isDuplicateInManager) {
      toast({
        title: "Camera Already Added",
        description: "This camera is already in the configuration.",
        variant: "destructive",
      });
      return;
    }

    try {
      console.log(`🆕 Adding WebRTC camera: ${cameraName} (${selectedCamera.deviceId})`);
      
      const sourceId = await webRTCManager.addLocalCamera(
        selectedCamera.deviceId,
        cameraName.trim(),
        "medium" // Default quality, user can change it later
      );

      // Save to backend
      await saveCameraToBackend(sourceId, cameraName, selectedCamera.deviceId, "medium");

      // Reset form
      setSelectedCameraIndex("");
      setCameraName("");

      toast({
        title: "Camera Added",
        description: `${cameraName} has been added successfully via WebRTC.`,
      });

    } catch (error) {
      console.error("❌ Failed to add camera:", error);
      toast({
        title: "Camera Add Failed",
        description: `Could not add camera: ${error.message}`,
        variant: "destructive",
      });
    }
  };

  // Update camera settings (resolution, FPS)
  const updateCameraSettings = async (sourceId: string, updates: Partial<UnifiedCameraSource>) => {
    const source = webrtcSources.find(s => s.id === sourceId);
    if (!source) {
      console.error("❌ Source not found for update:", sourceId);
      return;
    }

    try {
      console.log(`🔧 Updating camera settings for ${source.name}:`, updates);
      
      // Get new constraints based on updates
      const newWidth = updates.width || source.width;
      const newHeight = updates.height || source.height;
      const newFps = updates.fps || source.fps;
      
      // Get new media stream with updated constraints
      const newStream = await navigator.mediaDevices.getUserMedia({
        video: {
          deviceId: { exact: source.deviceId },
          width: { ideal: newWidth },
          height: { ideal: newHeight },
          frameRate: { ideal: newFps }
        }
      });

      // Stop old stream
      if (source.stream) {
        source.stream.getTracks().forEach(track => track.stop());
      }

      // Update the source in WebRTC manager
      const updatedSource = {
        ...source,
        width: newWidth,
        height: newHeight,
        fps: newFps,
        stream: newStream
      };

      // Update video element first
      const videoElement = videoRefs.current.get(sourceId);
      if (videoElement) {
        videoElement.srcObject = newStream;
        videoElement.play().catch(console.error);
      }

      // Update in WebRTC manager (this will handle peer connection updates)
      await webRTCManager.updateCamera(sourceId, updatedSource);
      
      // Update local state  
      setWebrtcSources(prev => prev.map(s => 
        s.id === sourceId ? updatedSource : s
      ));

      // Save updated config to backend
      const quality = newWidth >= 1280 ? "high" : newWidth >= 640 ? "medium" : "low";
      await saveCameraToBackend(sourceId, source.name, source.deviceId!, quality);

      toast({
        title: "Camera Updated",
        description: `${source.name} settings updated to ${newWidth}x${newHeight} @ ${newFps}fps`,
      });

    } catch (error) {
      console.error("❌ Failed to update camera settings:", error);
      toast({
        title: "Update Failed",
        description: `Could not update camera settings: ${error.message}`,
        variant: "destructive",
      });
    }
  };

  // Remove camera
  const removeCamera = async (sourceId: string) => {
    const source = webrtcSources.find(s => s.id === sourceId);
    if (!source) return;

    try {
      console.log(`🗑️ Removing WebRTC camera: ${source.name}`);
      
      webRTCManager.removeCamera(sourceId);
      
      // Remove from backend
      await removeCameraFromBackend(source.name);

      toast({
        title: "Camera Removed",
        description: `${source.name} has been removed.`,
      });

    } catch (error) {
      console.error("❌ Failed to remove camera:", error);
      toast({
        title: "Camera Remove Failed",
        description: `Could not remove camera: ${error.message}`,
        variant: "destructive",
      });
    }
  };

  // Backend integration
  const saveCameraToBackend = async (sourceId: string, name: string, deviceId: string, quality: CameraQuality) => {
    try {
      const constraints = CAMERA_CONSTRAINTS[quality];
      const backendConfig = {
        type: "webrtc",
        device_id: deviceId,
        source_id: sourceId,
        width: constraints.width,
        height: constraints.height,
        fps: constraints.fps,
        quality: quality,
        created_at: new Date().toISOString(),
      };

      const response = await fetchWithHeaders(`${baseUrl}/cameras/config/update`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          camera_name: name,
          camera_config: backendConfig
        }),
      });

      const result = await response.json();
      if (result.status !== "success") {
        console.error("❌ Backend save failed:", result.message);
      } else {
        console.log("✅ Camera saved to backend:", name);
      }
    } catch (error) {
      console.error("❌ Error saving to backend:", error);
    }
  };

  const removeCameraFromBackend = async (name: string) => {
    try {
      const response = await fetchWithHeaders(`${baseUrl}/cameras/config/${encodeURIComponent(name)}`, {
        method: "DELETE",
      });
      
      const result = await response.json();
      if (result.status === "success") {
        console.log("✅ Camera removed from backend:", name);
      }
    } catch (error) {
      console.error("❌ Error removing from backend:", error);
    }
  };

  const loadSavedCameraConfigs = async () => {
    try {
      console.log("🔄 Loading saved WebRTC camera configurations...");
      const response = await fetchWithHeaders(`${baseUrl}/cameras/config`);
      const data = await response.json();
      
      if (data.status === "success" && data.camera_config && data.camera_config.cameras) {
        const savedCameras = data.camera_config.cameras;
        console.log("📦 Found saved cameras:", Object.keys(savedCameras));
        
        // Load WebRTC cameras
        for (const [name, config] of Object.entries(savedCameras)) {
          if ((config as any).type === "webrtc" && (config as any).device_id && (config as any).source_id) {
            try {
              const quality = (config as any).quality || "medium";
              console.log(`🔄 Restoring WebRTC camera: ${name}`);
              
              await webRTCManager.addLocalCamera((config as any).device_id, name, quality);
            } catch (error) {
              console.error(`❌ Failed to restore camera ${name}:`, error);
            }
          }
        }
      }
    } catch (error) {
      console.error("❌ Error loading saved cameras:", error);
    }
  };

  // Release all streams function
  const releaseAllStreams = useCallback(() => {
    console.log("🔓 Releasing all WebRTC camera streams...");
    webrtcSources.forEach(source => {
      if (source.stream) {
        source.stream.getTracks().forEach(track => track.stop());
      }
    });
    webRTCManager.disconnect();
  }, [webrtcSources]);

  // Expose release function to parent
  useEffect(() => {
    if (releaseStreamsRef) {
      releaseStreamsRef.current = releaseAllStreams;
    }
  }, [releaseStreamsRef, releaseAllStreams]);

  // Auto-detect cameras on mount
  useEffect(() => {
    detectAvailableCameras();
  }, []);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold text-white border-b border-gray-700 pb-2">
          Camera Configuration
        </h3>
        <div className="flex gap-2 items-center">
          <Button
            onClick={detectAvailableCameras}
            disabled={isLoadingCameras}
            size="sm"
            variant="outline"
            className="border-blue-600 text-blue-400 hover:bg-blue-600 hover:text-white"
          >
            {isLoadingCameras ? (
              <>
                <RefreshCw className="w-4 h-4 mr-2 animate-spin" />
                Detecting...
              </>
            ) : (
              <>
                <RefreshCw className="w-4 h-4 mr-2" />
                Refresh Cameras
              </>
            )}
          </Button>
        </div>
      </div>

      {/* Add Camera Section */}
      {detectedCameras.length > 0 && isConnectedToSignaling && (
        <div className="bg-gray-800/50 rounded-lg p-4 space-y-4">
          <h4 className="text-md font-medium text-gray-300">Add Camera</h4>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className="space-y-2">
              <Label className="text-sm font-medium text-gray-300">
                Available Cameras
              </Label>
              <Select
                value={selectedCameraIndex}
                onValueChange={setSelectedCameraIndex}
                disabled={isLoadingCameras}
              >
                <SelectTrigger className="bg-gray-800 border-gray-700 text-white">
                  <SelectValue placeholder="Select camera" />
                </SelectTrigger>
                <SelectContent className="bg-gray-800 border-gray-700">
                  {detectedCameras.map((camera) => {
                    const isAlreadyAdded = webrtcSources.some(source => source.deviceId === camera.deviceId);
                    return (
                      <SelectItem
                        key={camera.index}
                        value={camera.index.toString()}
                        className="text-white hover:bg-gray-700"
                        disabled={isAlreadyAdded}
                      >
                        {camera.name}
                        {isAlreadyAdded && " (Added)"}
                      </SelectItem>
                    );
                  })}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label className="text-sm font-medium text-gray-300">
                Camera Name
              </Label>
              <Input
                value={cameraName}
                onChange={(e) => setCameraName(e.target.value)}
                placeholder="e.g., workspace_cam"
                className="bg-gray-800 border-gray-700 text-white"
              />
            </div>

            <div className="space-y-2 flex flex-col justify-end">
              <Button
                onClick={addCamera}
                className="bg-blue-500 hover:bg-blue-600 text-white"
                disabled={!selectedCameraIndex || !cameraName.trim() || !isConnectedToSignaling}
              >
                <Plus className="w-4 h-4 mr-2" />
                Add Camera
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* WebRTC Cameras */}
      {webrtcSources.length > 0 && (
        <div className="space-y-4">
          <h4 className="text-md font-medium text-gray-300">
            Cameras ({webrtcSources.length})
          </h4>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-2 gap-4">
            {webrtcSources.map((source) => (
              <WebRTCCameraPreview
                key={source.id}
                source={source}
                onRemove={() => removeCamera(source.id)}
                onUpdateSource={(updates) => {
                  updateCameraSettings(source.id, updates);
                }}
                videoRef={(el) => {
                  if (el) {
                    videoRefs.current.set(source.id, el);
                  } else {
                    videoRefs.current.delete(source.id);
                  }
                }}
              />
            ))}
          </div>
        </div>
      )}

      {webrtcSources.length === 0 && !isLoadingCameras && (
        <div className="text-center py-8 text-gray-500">
          <Camera className="w-12 h-12 mx-auto mb-4 text-gray-600" />
          <p>No cameras configured.</p>
          <p className="text-sm">
            {isConnectedToSignaling 
              ? "Click \"Refresh Cameras\" to detect available cameras and add them."
              : "Connecting..."
            }
          </p>
        </div>
      )}
    </div>
  );
};

// WebRTC Camera Preview Component
interface WebRTCCameraPreviewProps {
  source: UnifiedCameraSource;
  onRemove: () => void;
  onUpdateSource: (updates: Partial<UnifiedCameraSource>) => void;
  videoRef: (el: HTMLVideoElement | null) => void;
}

const WebRTCCameraPreview: React.FC<WebRTCCameraPreviewProps> = ({
  source,
  onRemove,
  onUpdateSource,
  videoRef,
}) => {
  const getStatusColor = () => {
    switch (source.status) {
      case 'connected': return 'text-green-400';
      case 'connecting': return 'text-yellow-400';
      case 'disconnected': return 'text-red-400';
      case 'error': return 'text-red-500';
      default: return 'text-gray-400';
    }
  };

  const getStatusIcon = () => {
    switch (source.status) {
      case 'connected': return <Wifi className="w-3 h-3" />;
      case 'connecting': return <RefreshCw className="w-3 h-3 animate-spin" />;
      case 'disconnected': return <WifiOff className="w-3 h-3" />;
      case 'error': return <X className="w-3 h-3" />;
      default: return <Camera className="w-3 h-3" />;
    }
  };

  return (
    <div className="bg-gray-900 rounded-lg border border-gray-700 overflow-hidden">
      {/* Camera Preview */}
      <div className="aspect-[4/3] bg-gray-800 relative">
        {source.stream && source.status === 'connected' ? (
          <>
            <video
              ref={(el) => {
                videoRef(el);
                if (el && source.stream) {
                  console.log(`🎥 Setting srcObject for ${source.name}`);
                  el.srcObject = source.stream;
                  el.play().catch(e => console.error(`Video play error for ${source.name}:`, e));
                }
              }}
              autoPlay
              muted
              playsInline
              className="w-full h-full object-cover"
            />
            <div className="absolute top-2 left-2">
              <div className="flex items-center gap-1 bg-black/50 px-2 py-1 rounded text-xs">
                <div className="w-1.5 h-1.5 bg-green-400 rounded-full animate-pulse"></div>
                <span className="text-green-400">LIVE</span>
              </div>
            </div>
          </>
        ) : (
          <div className="w-full h-full flex flex-col items-center justify-center">
            <VideoOff className="w-8 h-8 text-gray-500 mb-2" />
            <span className="text-gray-500 text-sm">
              {source.status === 'connecting' ? 'Connecting...' : 'No Stream'}
            </span>
          </div>
        )}
      </div>

      {/* Camera Info */}
      <div className="p-3 space-y-2">
        <div className="flex items-center justify-between">
          <h5 className="font-medium text-white truncate">
            {source.name}
          </h5>
          <Button
            onClick={onRemove}
            size="sm"
            variant="ghost"
            className="text-red-400 hover:text-red-300 hover:bg-red-900/20 p-1"
          >
            <X className="w-4 h-4" />
          </Button>
        </div>


        {/* Camera Controls */}
        <div className="grid grid-cols-2 gap-2 text-xs">
          <div className="space-y-1">
            <Label className="text-xs text-gray-400">Resolution</Label>
            <Select
              value={`${source.width}x${source.height}`}
              onValueChange={(value) => {
                const [width, height] = value.split('x').map(Number);
                onUpdateSource({ width, height });
              }}
            >
              <SelectTrigger className="bg-gray-800 border-gray-700 text-white text-xs h-6">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="bg-gray-800 border-gray-700">
                <SelectItem value="320x240" className="text-white hover:bg-gray-700 text-xs">320x240</SelectItem>
                <SelectItem value="640x480" className="text-white hover:bg-gray-700 text-xs">640x480</SelectItem>
                <SelectItem value="1280x720" className="text-white hover:bg-gray-700 text-xs">1280x720</SelectItem>
                <SelectItem value="1920x1080" className="text-white hover:bg-gray-700 text-xs">1920x1080</SelectItem>
              </SelectContent>
            </Select>
          </div>
          
          <div className="space-y-1">
            <Label className="text-xs text-gray-400">FPS</Label>
            <Select
              value={source.fps.toString()}
              onValueChange={(value) => {
                onUpdateSource({ fps: parseInt(value) });
              }}
            >
              <SelectTrigger className="bg-gray-800 border-gray-700 text-white text-xs h-6">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="bg-gray-800 border-gray-700">
                <SelectItem value="15" className="text-white hover:bg-gray-700 text-xs">15 fps</SelectItem>
                <SelectItem value="30" className="text-white hover:bg-gray-700 text-xs">30 fps</SelectItem>
                <SelectItem value="60" className="text-white hover:bg-gray-700 text-xs">60 fps</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
      </div>
    </div>
  );
};

export default WebRTCCameraConfiguration;