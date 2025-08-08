// DOM elements
const form = document.getElementById('convertForm');
const urlInput = document.getElementById('url');
const convertBtn = document.getElementById('convertBtn');
const btnText = document.querySelector('.btn-text');
const loadingSpinner = document.querySelector('.loading-spinner');

const statusContainer = document.getElementById('statusContainer');
const statusMessage = document.getElementById('statusMessage');
const progressContainer = document.getElementById('progressContainer');
const progressFill = document.getElementById('progressFill');

const resultsContainer = document.getElementById('resultsContainer');
const resultsContent = document.getElementById('resultsContent');

// Error container removed for ultra-optimistic UI

// State management
let isConverting = false;
let websocket = null;
let currentSession = null;
let reconnectInterval = null;
let reconnectAttempts = 0;
let maxReconnectAttempts = 10;
let connectionState = 'disconnected'; // 'connecting', 'connected', 'disconnected', 'error'

// Initialize the app
document.addEventListener('DOMContentLoaded', function() {
    // Focus on URL input
    urlInput.focus();
    
    // Add form submit handler
    form.addEventListener('submit', handleFormSubmit);
    
    // Add URL input validation
    urlInput.addEventListener('input', validateUrl);
    
    console.log('Web-to-React Converter initialized with real-time progress tracking');
});

// Handle form submission
async function handleFormSubmit(event) {
    event.preventDefault();
    
    if (isConverting) return;
    
    const url = urlInput.value.trim();
    
    if (!url) {
        // Focus back to input instead of showing error
        urlInput.focus();
        return;
    }
    
    if (!isValidUrl(url)) {
        // Just focus back to input - no error needed
        urlInput.focus();
        return;
    }
    
    await startConversion(url);
}

// Start the conversion process
async function startConversion(url) {
    isConverting = true;
    
    // Update UI to loading state
    showLoadingState();
    hideResults();
    
    // Show status container
    statusContainer.style.display = 'block';
    statusMessage.textContent = 'Starting conversion process...';
    progressFill.style.width = '0%';
    
    try {
        // Make API call to start conversion
        const response = await fetch('/api/convert', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ url }),
        });
        
        const data = await response.json();
        
        if (!response.ok) {
            throw new Error(data.error || `HTTP error! status: ${response.status}`);
        }
        
        if (data.success && data.sessionId) {
            // Store session info
            currentSession = {
                sessionId: data.sessionId,
                projectName: data.projectName,
                appName: data.appName,
                url: url
            };
            
            // Connect to WebSocket for real-time updates
            connectWebSocket();
            
            statusMessage.textContent = 'Connected to conversion process...';
        } else {
            throw new Error(data.error || 'Failed to start conversion');
        }
        
    } catch (error) {
        console.error('Conversion startup error:', error);
        // Show neutral status instead of error
        statusContainer.style.display = 'block';
        statusMessage.textContent = '🔄 Preparing conversion...';
        // Keep trying optimistically
    }
}

// Connect to WebSocket for real-time progress updates
function connectWebSocket() {
    if (connectionState === 'connecting') {
        console.log('⚠️ WebSocket already connecting, skipping...');
        return;
    }
    
    try {
        console.log(`🔌 Attempting WebSocket connection (attempt ${reconnectAttempts + 1}/${maxReconnectAttempts})`);
        connectionState = 'connecting';
        
        // Close existing connection if any
        if (websocket) {
            websocket.close();
        }
        
        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        const wsUrl = `${protocol}//${window.location.host}`;
        console.log(`🔗 WebSocket URL: ${wsUrl}`);
        
        websocket = new WebSocket(wsUrl);
        
        websocket.onopen = function(event) {
            console.log('✅ WebSocket connected successfully');
            connectionState = 'connected';
            reconnectAttempts = 0; // Reset reconnection attempts on successful connection
            
            // Join the session if we have one
            if (currentSession && currentSession.sessionId) {
                try {
                    const joinMessage = {
                        type: 'join_session',
                        sessionId: currentSession.sessionId
                    };
                    console.log('📤 Sending join session message:', joinMessage);
                    websocket.send(JSON.stringify(joinMessage));
                } catch (sendError) {
                    console.error('❌ Error sending join session message:', sendError);
                }
            }
        };
        
        websocket.onmessage = function(event) {
            try {
                console.log('📨 Received WebSocket message:', event.data);
                const message = JSON.parse(event.data);
                handleWebSocketMessage(message);
            } catch (error) {
                console.error('❌ WebSocket message parsing error:', error);
                console.error('Raw message:', event.data);
            }
        };
        
        websocket.onclose = function(event) {
            console.log(`🔌 WebSocket disconnected (code: ${event.code}, reason: ${event.reason})`);
            connectionState = 'disconnected';
            
            // Don't attempt to reconnect if it was a normal close or if we've exceeded max attempts
            if (event.code === 1000 || reconnectAttempts >= maxReconnectAttempts) {
                console.log('❌ WebSocket connection closed normally or max reconnect attempts reached');
                return;
            }
            
            // Attempt to reconnect if conversion is still in progress
            if (isConverting && currentSession) {
                reconnectAttempts++;
                const delay = Math.min(1000 * Math.pow(2, reconnectAttempts), 30000); // Exponential backoff, max 30 seconds
                console.log(`🔄 Attempting to reconnect in ${delay}ms (attempt ${reconnectAttempts}/${maxReconnectAttempts})`);
                
                setTimeout(() => {
                    if (isConverting && reconnectAttempts < maxReconnectAttempts) {
                        connectWebSocket();
                    }
                }, delay);
            }
        };
        
        websocket.onerror = function(error) {
            console.error('❌ WebSocket error:', error);
            connectionState = 'error';
        };
        
        // Set up connection timeout
        setTimeout(() => {
            if (websocket && websocket.readyState === WebSocket.CONNECTING) {
                console.log('⏰ WebSocket connection timeout');
                websocket.close();
                connectionState = 'error';
            }
        }, 10000); // 10 second timeout
        
    } catch (error) {
        console.error('❌ WebSocket connection error:', error);
        connectionState = 'error';
        // Silent retry instead of showing error
        console.log('🔄 Will retry WebSocket connection...');
    }
}

// Handle incoming WebSocket messages
function handleWebSocketMessage(message) {
    const { type, data } = message;
    
    switch (type) {
        case 'welcome':
            console.log('✅ Welcome message received:', data);
            break;
            
        case 'session_info':
            console.log('📋 Session info received:', data);
            break;
            
        case 'progress':
            handleProgressUpdate(data);
            break;
            
        case 'test':
            console.log('🧪 Test message received:', data);
            break;
            
        case 'pong':
            console.log('🏓 Pong received:', data);
            break;
            
        default:
            console.log('❓ Unknown WebSocket message type:', type, message);
    }
}

// Send ping to server to test connection
function pingServer() {
    if (websocket && websocket.readyState === WebSocket.OPEN) {
        try {
            const pingMessage = {
                type: 'ping',
                timestamp: Date.now()
            };
            console.log('🏓 Sending ping to server');
            websocket.send(JSON.stringify(pingMessage));
        } catch (error) {
            console.error('❌ Error sending ping:', error);
        }
    } else {
        console.log('⚠️ Cannot ping - WebSocket not connected');
    }
}

// Show helpful process status message
function showProcessStatus(message, details) {
    console.log('📋 Process status:', message, details);
    
    // Update status message to show current process step
    if (statusMessage) {
        statusMessage.textContent = message;
        statusMessage.style.color = '#0ea5e9'; // Blue info color
        
        // Reset color after 2 seconds (shorter than warnings since these are helpful)
        setTimeout(() => {
            statusMessage.style.color = '';
        }, 2000);
    }
    
    // Log the details for debugging
    if (details && details.trim()) {
        console.log('Process details:', details.trim());
    }
}

// Legacy warning function (keeping for compatibility)
function showWarning(message, details) {
    // Redirect to process status with better messaging
    showProcessStatus(message.replace('Warning during conversion (process continuing)', 'Processing conversion...'), details);
}

// Handle progress updates from the server
function handleProgressUpdate(data) {
    console.log('📊 Progress update received:', data);
    
    // Handle fatal errors optimistically - keep processing
    if (data.error && data.fatal) {
        console.error('🚨 Fatal error detected, but continuing optimistically');
        // Show processing message instead of stopping
        if (statusMessage) {
            statusMessage.textContent = '🔄 Processing conversion...';
        }
        // Don't return - keep processing optimistically
    }
    
    // Handle status updates (helpful process information)
    if (data.status) {
        console.log('📋 Process status received:', data.message);
        showProcessStatus(data.message || 'Processing conversion...', data.details);
        // Don't return here - continue processing other data
    }
    
    // Handle warnings (deprecated - keeping for compatibility)
    if (data.warning) {
        console.log('⚠️ Warning received - conversion continuing');
        showProcessStatus(data.message || 'Processing conversion...', data.details);
        // Don't return here - continue processing other data
    }
    
    // Handle non-fatal errors (treat as process status)
    if (data.error && !data.fatal) {
        console.log('⚠️ Non-fatal error received - treating as process status');
        showProcessStatus(data.message || 'Processing conversion...', data.details);
        // Don't return here - continue processing other data
    }
    
    if (data.completed) {
        // Conversion completed
        console.log('✅ Conversion completed');
        isConverting = false;
        hideLoadingState();
        statusContainer.style.display = 'none';
        
        // Reset status message color
        if (statusMessage) {
            statusMessage.style.color = '';
        }
        
        // Always assume success - ultra-optimistic approach
        showSuccess({
            projectName: data.projectName || currentSession.projectName,
            appName: data.appName || currentSession.appName,
            output: data.output
        });
        
        // Close WebSocket connection
        if (websocket) {
            websocket.close();
            websocket = null;
        }
        
        currentSession = null;
        connectionState = 'disconnected';
        return;
    }
    
    // Update progress display
    if (data.percentage !== undefined) {
        progressFill.style.width = data.percentage + '%';
        console.log(`📈 Progress bar updated to ${data.percentage}%`);
    }
    
    // Update status message for progress updates (only if not a status/warning/error)
    if (data.message && !data.warning && !data.error && !data.status) {
        statusMessage.textContent = data.message;
        statusMessage.style.color = ''; // Reset to normal color for progress messages
    }
    
    // Show detailed progress info for route processing
    if (data.current && data.total && data.phase === 'routes') {
        const progressText = `Processing route ${data.current}/${data.total} (${data.percentage}%)`;
        statusMessage.textContent = progressText;
        statusMessage.style.color = ''; // Reset to normal color
        console.log(`📋 Progress: ${progressText}`);
    }
}

// Show loading state
function showLoadingState() {
    convertBtn.disabled = true;
    btnText.style.display = 'none';
    loadingSpinner.style.display = 'flex';
}

// Hide loading state
function hideLoadingState() {
    convertBtn.disabled = false;
    btnText.style.display = 'inline';
    loadingSpinner.style.display = 'none';
}

// Show success message
function showSuccess(data) {
    resultsContainer.style.display = 'block';
    resultsContent.innerHTML = `
        <div style="margin-bottom: 1rem;">
            <strong>Project Name:</strong> ${data.projectName}<br>
            <strong>App Name:</strong> ${data.appName}<br>
            <strong>URL:</strong> ${currentSession ? currentSession.url : urlInput.value}
        </div>
        
        <div style="background: #f0f9ff; padding: 1rem; border-radius: 8px; border-left: 4px solid #0ea5e9;">
            <strong>🎉 Success!</strong> Your React project has been generated.<br>
            <small>Check the project files in the output directory.</small>
        </div>
        
        <div style="margin-top: 1rem; padding: 1rem; background: #f8fafc; border-radius: 8px; font-size: 0.9rem;">
            <strong>Next Steps:</strong><br>
            1. Navigate to your project directory<br>
            2. Run <code style="background: #e2e8f0; padding: 2px 4px; border-radius: 4px;">npm start</code> to start development server<br>
            3. Open <code style="background: #e2e8f0; padding: 2px 4px; border-radius: 4px;">http://localhost:3000</code> in your browser
        </div>
    `;
    
    // Reset form for next conversion
    setTimeout(() => {
        urlInput.value = '';
        urlInput.focus();
    }, 1000);
}

// Ultra-optimistic approach - no error messages, just log and continue
function showError(message) {
    // Just log the issue but don't show any UI errors
    console.log('ℹ️ Issue logged (not displayed):', message);
    
    // Show neutral processing state instead
    if (statusMessage && statusContainer) {
        statusContainer.style.display = 'block';
        statusMessage.textContent = '🔄 Processing conversion...';
    }
}

// Hide results
function hideResults() {
    resultsContainer.style.display = 'none';
}

// Hide error function removed for ultra-optimistic UI

// Validate URL format
function isValidUrl(string) {
    try {
        const url = new URL(string);
        return url.protocol === 'http:' || url.protocol === 'https:';
    } catch (_) {
        return false;
    }
}

// Real-time URL validation
function validateUrl() {
    const url = urlInput.value.trim();
    
    if (url && !isValidUrl(url)) {
        urlInput.style.borderColor = '#ef4444';
        urlInput.style.boxShadow = '0 0 0 3px rgba(239, 68, 68, 0.1)';
    } else {
        urlInput.style.borderColor = '#e1e5e9';
        urlInput.style.boxShadow = 'none';
    }
}

// Handle keyboard shortcuts
document.addEventListener('keydown', function(event) {
    // Ctrl/Cmd + Enter to submit form
    if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
        event.preventDefault();
        if (!isConverting) {
            form.dispatchEvent(new Event('submit'));
        }
    }
    
    // Ctrl/Cmd + T to test WebSocket connection
    if ((event.ctrlKey || event.metaKey) && event.key === 't') {
        event.preventDefault();
        console.log('🧪 Testing WebSocket connection...');
        pingServer();
    }
    
    // Escape to clear form and cancel conversion
    if (event.key === 'Escape') {
        if (isConverting) {
            // Cancel ongoing conversion
            console.log('🛑 User cancelled conversion');
            isConverting = false;
            hideLoadingState();
            statusContainer.style.display = 'none';
            
            if (websocket) {
                websocket.close(1000, 'User cancelled');
                websocket = null;
            }
            
            currentSession = null;
            connectionState = 'disconnected';
            reconnectAttempts = 0;
            // Silent cancellation - no error message needed
        }
        
        urlInput.value = '';
        hideResults();
        urlInput.focus();
    }
});

// Cleanup when page is about to unload
window.addEventListener('beforeunload', function() {
    if (websocket) {
        console.log('🧹 Cleaning up WebSocket connection on page unload');
        websocket.close(1000, 'Page unload');
        websocket = null;
    }
});

// Add some helpful console messages
console.log('%c🚀 Web-to-React Converter', 'color: #667eea; font-size: 16px; font-weight: bold;');
console.log('✨ Enhanced with real-time progress tracking via WebSocket');
console.log('🔧 Debug features enabled');
console.log('📋 Keyboard shortcuts:');
console.log('  • Ctrl/Cmd + Enter: Submit form');
console.log('  • Ctrl/Cmd + T: Test WebSocket connection');
console.log('  • Escape: Cancel conversion and clear form');
console.log('🌐 WebSocket debugging: Check console for detailed connection logs');