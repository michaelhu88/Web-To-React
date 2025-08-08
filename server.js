const express = require('express');
const path = require('path');
const { spawn } = require('child_process');
const fs = require('fs');
const WebSocket = require('ws');
const http = require('http');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });
const port = process.env.PORT || 3000;

// Store active conversion sessions
const activeConversions = new Map();

// Middleware
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Utility function to extract domain name and generate project names from URL
function generateProjectNames(url) {
    try {
        const urlObj = new URL(url);
        let domain = urlObj.hostname;
        
        // Remove 'www.' if present
        domain = domain.replace(/^www\./, '');
        
        // Extract the main part (without .com, .org, etc.)
        const domainParts = domain.split('.');
        let mainDomain = domainParts[0];
        
        // Capitalize first letter and make it a valid component name
        const projectName = mainDomain.charAt(0).toUpperCase() + mainDomain.slice(1).toLowerCase();
        
        // Generate app name (lowercase, sanitized)
        const appName = mainDomain.toLowerCase().replace(/[^a-z0-9]/g, '');
        
        return { projectName, appName };
    } catch (error) {
        throw new Error('Invalid URL format');
    }
}

// Validate URL format
function isValidUrl(string) {
    try {
        new URL(string);
        return true;
    } catch (_) {
        return false;
    }
}

// Function to read total route count from routes.json
function getTotalRoutes(outputDir) {
    try {
        const routesPath = path.join(outputDir, 'routes.json');
        if (fs.existsSync(routesPath)) {
            const routes = JSON.parse(fs.readFileSync(routesPath, 'utf8'));
            return Array.isArray(routes) ? routes.length : 0;
        }
    } catch (error) {
        console.warn('Could not read routes.json:', error.message);
    }
    return 0;
}

// Function to detect current process step and generate helpful status message
function detectProcessStep(output, isStderr = false) {
    // Puppeteer/Browser launching
    if (output.includes('Puppeteer') || output.includes('Browser launched') || output.includes('headless')) {
        return '🚀 Launching browser for page extraction...';
    }
    
    // HTML extraction
    if (output.includes('Extracting HTML') || output.includes('fully rendered HTML') || output.includes('Saved rendered HTML')) {
        return '📄 Extracting page content and structure...';
    }
    
    // CSS processing
    if (output.includes('Extracting CSS') || output.includes('Processing styles') || output.includes('styles...')) {
        return '🎨 Processing styles and CSS assets...';
    }
    
    // Image/Asset processing  
    if (output.includes('Downloading') || output.includes('images') || output.includes('fonts') || output.includes('assets')) {
        return '🖼️ Downloading and processing assets...';
    }
    
    // JSX conversion
    if (output.includes('Converting') || output.includes('JSX') || output.includes('React component')) {
        return '⚛️ Converting HTML to React components...';
    }
    
    // React app creation
    if (output.includes('Creating React app') || output.includes('create-react-app') || output.includes('npm install')) {
        return '📦 Creating React project structure...';
    }
    
    // Dependencies installation
    if (output.includes('Installing') || output.includes('dependencies') || output.includes('package.json')) {
        return '⬇️ Installing project dependencies...';
    }
    
    // Default processing message
    return '🔄 Processing conversion...';
}

// Function to parse CLI output for progress with phase-based calculation
function parseProgress(output, totalRoutes) {
    // Look for pattern: "📄 Processing route X/Y:"
    const match = output.match(/📄 Processing route (\d+)\/(\d+):/);    
    if (match) {
        const currentRoute = parseInt(match[1]);
        const totalFromLog = parseInt(match[2]);
        
        // Phase-based progress: routes take 0-80%, final steps take 80-100%
        // This prevents the bar from reaching 100% until truly complete
        const routeProgress = (currentRoute / totalFromLog) * 80; // Routes = 80% of total progress
        
        return {
            current: currentRoute,
            total: totalFromLog,
            percentage: Math.round(routeProgress),
            phase: 'routes',
            isProcessing: true
        };
    }
    
    // Check for route processing completion (start of app creation phase)
    if (output.includes('✨ All') && output.includes('routes processed successfully')) {
        return {
            current: totalRoutes,
            total: totalRoutes,
            percentage: 80, // 80% - routes complete, starting app creation
            phase: 'app_creation',
            isProcessing: true
        };
    }
    
    // Check for React app creation
    if (output.includes('Creating React app') || output.includes('create-react-app')) {
        return {
            current: totalRoutes,
            total: totalRoutes,
            percentage: 90, // 90% - app creation in progress
            phase: 'app_creation',
            isProcessing: true
        };
    }
    
    // Check for dependency installation
    if (output.includes('npm install') || output.includes('Dependencies installed')) {
        return {
            current: totalRoutes,
            total: totalRoutes,
            percentage: 95, // 95% - installing dependencies
            phase: 'dependencies',
            isProcessing: true
        };
    }
    
    // Check for final completion - only trigger on the FINAL success message
    if (output.includes('🎉 Multi-component React project created successfully!') || 
        (output.includes('Multi-component React project created successfully') && output.includes('🎉'))) {
        return {
            current: totalRoutes,
            total: totalRoutes,
            percentage: 100,
            phase: 'complete',
            isProcessing: false,
            completed: true
        };
    }
    
    return null;
}

// Function to classify stderr output as warning or fatal error
function classifyStderrMessage(message) {
    // Known warning patterns that should not stop conversion
    const warningPatterns = [
        // Puppeteer deprecation warnings
        /Puppeteer old Headless deprecation warning/i,
        /headless.*will default to.*new Headless mode/i,
        /Consider opting in early by passing.*headless.*new/i,
        
        // Browser console warnings
        /Console warning/i,
        /deprecated/i,
        
        // Dependency warnings
        /npm warn/i,
        /warning.*deprecated/i,
        
        // Non-critical browser warnings
        /DevTools listening/i,
        /Download the React DevTools/i
    ];
    
    // Fatal error patterns that should stop conversion
    const fatalPatterns = [
        /Error:/i,
        /Failed to/i,
        /Cannot/i,
        /Unable to/i,
        /Connection refused/i,
        /ECONNREFUSED/i,
        /Network error/i,
        /Timeout/i,
        /Process exited with/i
    ];
    
    // Check for fatal errors first
    if (fatalPatterns.some(pattern => pattern.test(message))) {
        return { type: 'fatal', severity: 'error' };
    }
    
    // Check for warnings
    if (warningPatterns.some(pattern => pattern.test(message))) {
        return { type: 'warning', severity: 'warning' };
    }
    
    // Default to warning for unknown stderr messages (safer approach)
    return { type: 'warning', severity: 'warning' };
}

// Function to broadcast progress to all connected WebSocket clients
function broadcastProgress(sessionId, progressData) {
    console.log(`📡 Broadcasting progress to session ${sessionId}:`, progressData);
    
    let sentCount = 0;
    let errorCount = 0;
    
    wss.clients.forEach((client, index) => {
        try {
            // Check if client is associated with this session
            if (client.sessionId === sessionId) {
                // Double-check WebSocket state before sending
                if (client.readyState === WebSocket.OPEN) {
                    const message = JSON.stringify({
                        type: 'progress',
                        data: progressData
                    });
                    
                    console.log(`📤 Sending progress to client ${client.clientId || index} (session: ${sessionId})`);
                    client.send(message);
                    sentCount++;
                } else {
                    console.log(`⚠️ Client ${client.clientId || index} not in OPEN state: ${client.readyState}`);
                }
            }
        } catch (error) {
            errorCount++;
            console.error(`❌ Error sending progress to client ${client.clientId || index}:`, error);
            
            // Try to close the problematic client connection gracefully
            try {
                if (client.readyState === WebSocket.OPEN) {
                    client.close(1000, 'Error sending message');
                }
            } catch (closeError) {
                console.error(`Error closing problematic client ${client.clientId || index}:`, closeError);
            }
        }
    });
    
    console.log(`📊 Progress broadcast summary - Sent: ${sentCount}, Errors: ${errorCount}, Total clients: ${wss.clients.size}`);
}

// API endpoint to handle conversion requests
app.post('/api/convert', async (req, res) => {
    const { url } = req.body;
    
    if (!url) {
        return res.status(400).json({ error: 'URL is required' });
    }
    
    if (!isValidUrl(url)) {
        return res.status(400).json({ error: 'Invalid URL format' });
    }
    
    try {
        // Generate project names from URL
        const { projectName, appName } = generateProjectNames(url);
        const sessionId = Date.now().toString(); // Simple session ID
        const outputDir = path.join(__dirname, 'output');
        
        console.log(`Starting conversion for: ${url} (Session: ${sessionId})`);
        console.log(`Project name: ${projectName}, App name: ${appName}`);
        
        // Store session info
        activeConversions.set(sessionId, {
            url,
            projectName,
            appName,
            startTime: Date.now(),
            completed: false
        });
        
        // Return session ID immediately so client can connect via WebSocket
        res.json({
            success: true,
            message: 'Conversion started',
            sessionId,
            projectName,
            appName
        });
        
        // Start the conversion process asynchronously
        const command = 'node';
        const args = ['html-to-react.js', url, projectName, '--create-app', '--app-name', appName, '-h'];
        
        console.log(`Executing: ${command} ${args.join(' ')}`);
        
        const childProcess = spawn(command, args, {
            cwd: __dirname,
            stdio: 'pipe'
        });
        
        let totalRoutes = 0;
        let output = '';
        
        // Handle stdout data
        childProcess.stdout.on('data', (data) => {
            const chunk = data.toString();
            output += chunk;
            console.log('STDOUT:', chunk);
            
            // Try to get total routes if we haven't yet
            if (totalRoutes === 0) {
                totalRoutes = getTotalRoutes(outputDir);
            }
            
            // Parse progress from CLI output
            const progress = parseProgress(chunk, totalRoutes);
            if (progress) {
                console.log('Progress detected:', progress);
                
                // Create appropriate message based on progress phase
                let progressMessage;
                if (progress.phase === 'routes') {
                    progressMessage = `Processing route ${progress.current}/${progress.total} (${progress.percentage}%)`;
                } else if (progress.phase === 'app_creation') {
                    progressMessage = '📦 Creating React project structure...';
                } else if (progress.phase === 'dependencies') {
                    progressMessage = '⬇️ Installing project dependencies...';
                } else if (progress.phase === 'complete') {
                    progressMessage = '✅ Conversion completed successfully!';
                } else {
                    progressMessage = `Processing route ${progress.current}/${progress.total}`;
                }
                
                broadcastProgress(sessionId, {
                    ...progress,
                    message: progressMessage,
                    url,
                    projectName
                });
                
                // Mark session as completed if this is a completion progress update
                if (progress.completed) {
                    const session = activeConversions.get(sessionId);
                    if (session) {
                        session.completed = true;
                        console.log('✅ Marked session as completed via progress parsing');
                    }
                }
            } else {
                // If no specific progress detected, check if we can identify the current step
                const processStatus = detectProcessStep(chunk);
                if (processStatus !== '🔄 Processing conversion...') { // Only send if it's a specific step
                    console.log('📋 Process step detected:', processStatus);
                    broadcastProgress(sessionId, {
                        status: true,
                        severity: 'info', 
                        message: processStatus,
                        url,
                        projectName,
                        timestamp: Date.now()
                    });
                }
            }
        });
        
        // Handle stderr data with smart classification and helpful status messages
        childProcess.stderr.on('data', (data) => {
            const chunk = data.toString();
            console.error('STDERR:', chunk);
            
            // Classify the stderr message
            const classification = classifyStderrMessage(chunk);
            console.log(`🔍 Classified stderr as: ${classification.type} (${classification.severity})`);
            
            if (classification.type === 'fatal') {
                // Ultra-optimistic: Log fatal errors but don't broadcast them - keep going
                console.log('🚨 Fatal error detected but continuing optimistically:', chunk.trim());
                
                // Broadcast optimistic processing message instead
                broadcastProgress(sessionId, {
                    status: true,
                    severity: 'info',
                    message: '🔄 Processing conversion...',
                    details: 'Handling conversion step...',
                    timestamp: Date.now()
                });
            } else {
                // Detect what process step we're at and show helpful status
                const processStatus = detectProcessStep(chunk, true);
                console.log('🔄 Broadcasting process status:', processStatus);
                
                broadcastProgress(sessionId, {
                    status: true,
                    severity: 'info',
                    message: processStatus,
                    details: chunk.trim(),
                    timestamp: Date.now()
                });
            }
        });
        
        // Handle process completion - only complete if we haven't already detected completion via parseProgress
        childProcess.on('close', (code) => {
            console.log(`Conversion process exited with code ${code}`);
            
            // Check if we haven't already sent completion via parseProgress
            const session = activeConversions.get(sessionId);
            if (session && !session.completed) {
                // Only send completion if the process exited successfully and we haven't already completed
                if (code === 0) {
                    console.log('🎯 Process completed successfully, sending final completion');
                    broadcastProgress(sessionId, {
                        completed: true,
                        success: true,
                        percentage: 100,
                        message: 'Conversion completed successfully!',
                        projectName,
                        appName,
                        output
                    });
                } else {
                    console.log(`⚠️ Process exited with non-zero code ${code}, not sending completion`);
                    // Optionally send an error status here if needed
                }
            } else if (session && session.completed) {
                console.log('✅ Completion already sent via progress parsing, skipping duplicate');
            }
            
            // Clean up session
            activeConversions.delete(sessionId);
        });
        
        // Handle process error
        childProcess.on('error', (error) => {
            console.error('Process error:', error);
            
            // Check if we haven't already sent completion
            const session = activeConversions.get(sessionId);
            if (session && !session.completed) {
                console.log('❌ Process error occurred, not sending completion');
                // Optionally send error status to client if needed
                broadcastProgress(sessionId, {
                    error: true,
                    fatal: false, // Keep optimistic by not marking as fatal
                    message: 'Processing conversion...',
                    details: 'Encountered an issue but continuing processing'
                });
            }
            
            // Clean up session
            activeConversions.delete(sessionId);
        });
        
    } catch (error) {
        console.error('Conversion setup error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to start conversion',
            details: error.message
        });
    }
});

// Health check endpoint
app.get('/api/health', (req, res) => {
    res.json({ status: 'OK', message: 'Web-to-React frontend server is running' });
});

// Serve the main frontend page
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// WebSocket test endpoint for debugging
app.get('/api/ws-test', (req, res) => {
    const testData = { message: 'WebSocket test', timestamp: Date.now() };
    
    let clientCount = 0;
    wss.clients.forEach(client => {
        if (client.readyState === WebSocket.OPEN) {
            clientCount++;
            try {
                client.send(JSON.stringify({
                    type: 'test',
                    data: testData
                }));
            } catch (error) {
                console.error('WebSocket test error:', error);
            }
        }
    });
    
    res.json({
        success: true,
        message: `Test message sent to ${clientCount} clients`,
        totalClients: wss.clients.size,
        activeClients: clientCount
    });
});

// WebSocket connection handling
wss.on('connection', (ws, req) => {
    const clientId = Math.random().toString(36).substring(7);
    ws.clientId = clientId;
    console.log(`🔌 WebSocket client connected (ID: ${clientId}), Total clients: ${wss.clients.size}`);
    
    // Send a welcome message
    try {
        ws.send(JSON.stringify({
            type: 'welcome',
            data: { clientId, message: 'Connected to Web-to-React server' }
        }));
    } catch (error) {
        console.error(`❌ Error sending welcome message to client ${clientId}:`, error);
    }
    
    ws.on('message', (message) => {
        try {
            const data = JSON.parse(message);
            console.log(`📨 Message from client ${clientId}:`, data);
            
            if (data.type === 'join_session' && data.sessionId) {
                ws.sessionId = data.sessionId;
                console.log(`✅ Client ${clientId} joined session: ${data.sessionId}`);
                
                // Send current session info if available
                const sessionInfo = activeConversions.get(data.sessionId);
                if (sessionInfo) {
                    try {
                        const sessionMessage = JSON.stringify({
                            type: 'session_info',
                            data: sessionInfo
                        });
                        console.log(`📤 Sending session info to client ${clientId} for session: ${data.sessionId}`);
                        ws.send(sessionMessage);
                        console.log(`✅ Session info sent successfully to client ${clientId}`);
                    } catch (sendError) {
                        console.error(`❌ Error sending session info to client ${clientId}:`, sendError);
                    }
                } else {
                    console.log(`⚠️ No session info found for session: ${data.sessionId}`);
                }
            } else if (data.type === 'ping') {
                // Handle ping/pong for connection testing
                try {
                    ws.send(JSON.stringify({ type: 'pong', data: { timestamp: Date.now() } }));
                } catch (error) {
                    console.error(`❌ Error sending pong to client ${clientId}:`, error);
                }
            }
        } catch (error) {
            console.error(`❌ WebSocket message parsing error from client ${clientId}:`, error);
            console.error('Raw message:', message);
        }
    });
    
    ws.on('close', (code, reason) => {
        console.log(`🔌 WebSocket client ${clientId} disconnected (code: ${code}, reason: ${reason}), Remaining clients: ${wss.clients.size - 1}`);
    });
    
    ws.on('error', (error) => {
        console.error(`❌ WebSocket error from client ${clientId}:`, error);
    });
    
    // Set up a heartbeat to detect disconnected clients
    ws.isAlive = true;
    ws.on('pong', () => {
        ws.isAlive = true;
    });
});

// Heartbeat interval to detect dead connections
const heartbeatInterval = setInterval(() => {
    wss.clients.forEach((ws) => {
        if (ws.isAlive === false) {
            console.log(`💔 Terminating dead connection for client ${ws.clientId}`);
            return ws.terminate();
        }
        
        ws.isAlive = false;
        try {
            ws.ping();
        } catch (error) {
            console.error(`❌ Error pinging client ${ws.clientId}:`, error);
        }
    });
}, 30000); // Check every 30 seconds

// Start server
server.listen(port, () => {
    console.log(`🚀 Web-to-React frontend server running at http://localhost:${port}`);
    console.log(`📁 Serving static files from: ${path.join(__dirname, 'public')}`);
    console.log(`🔌 WebSocket server ready for real-time progress updates`);
});