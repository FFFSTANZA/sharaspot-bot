// src/index.ts - BULLETPROOF RAILWAY VERSION
import express from 'express';
import cors from 'cors';

// Simple environment handling - no complex validation
const VERIFY_TOKEN = process.env.VERIFY_TOKEN || 'default_verify_token';

// ===============================================
// BASIC EXPRESS SETUP - NO COMPLEX IMPORTS
// ===============================================

const app = express();
const PORT = parseInt(process.env.PORT || '3000', 10);

console.log('🚀 Starting SharaSpot Bot Server...');
console.log(`📊 Port: ${PORT}`);
console.log(`🌍 Environment: ${process.env.NODE_ENV || 'development'}`);

// Basic middleware
app.set('trust proxy', true);
app.use(cors({ origin: '*' }));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// Simple request logger
app.use((req, res, next) => {
  console.log(`📝 ${req.method} ${req.path} - ${new Date().toISOString()}`);
  next();
});

// ===============================================
// SIMPLE ROUTES - NO EXTERNAL DEPENDENCIES
// ===============================================

// Root route - GUARANTEED TO WORK
app.get('/', (req, res) => {
  console.log('✅ ROOT ROUTE ACCESSED!');
  
  const response = {
    message: '🔋 SharaSpot WhatsApp Bot',
    status: 'running',
    timestamp: new Date().toISOString(),
    port: PORT,
    environment: process.env.NODE_ENV || 'development',
    uptime: Math.floor(process.uptime()),
    memory: Math.round(process.memoryUsage().heapUsed / 1024 / 1024) + 'MB',
    success: true
  };
  
  res.status(200).json(response);
});

// Health check - Simple and reliable
app.get('/health', (req, res) => {
  console.log('❤️ HEALTH CHECK ACCESSED');
  
  res.status(200).json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    uptime: Math.floor(process.uptime()),
    memory: Math.round(process.memoryUsage().heapUsed / 1024 / 1024) + 'MB',
    port: PORT
  });
});

// Simple webhook verification
app.get('/webhook', (req, res) => {
  console.log('🪝 WEBHOOK VERIFICATION');
  
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];
  
  console.log('Verification details:', { mode, token: !!token, challenge: !!challenge });
  
  if (mode === 'subscribe' && token === VERIFY_TOKEN) {
    console.log('✅ Webhook verified successfully');
    res.status(200).send(challenge);
  } else {
    console.log('❌ Webhook verification failed');
    res.status(403).json({ error: 'Verification failed' });
  }
});

// Simple webhook message handler
app.post('/webhook', (req, res) => {
  console.log('📨 WEBHOOK MESSAGE RECEIVED');
  
  try {
    const body = req.body;
    console.log('Message data:', JSON.stringify(body, null, 2));
    
    // Just acknowledge for now
    res.status(200).send('EVENT_RECEIVED');
    
    // You can add actual message processing here later
    
  } catch (error: any) {
    console.error('❌ Webhook error:', error.message);
    res.status(500).json({ error: 'Processing failed' });
  }
});

// 404 handler
app.use('*', (req, res) => {
  console.log(`❌ 404 - Route not found: ${req.method} ${req.originalUrl}`);
  
  res.status(404).json({
    error: 'Route not found',
    method: req.method,
    path: req.originalUrl,
    timestamp: new Date().toISOString(),
    availableRoutes: [
      'GET /',
      'GET /health', 
      'GET /webhook',
      'POST /webhook'
    ]
  });
});

// Error handler
app.use((error: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
  console.error('💥 Server error:', error.message);
  
  res.status(500).json({
    error: 'Internal server error',
    message: error.message,
    timestamp: new Date().toISOString()
  });
});

// ===============================================
// START SERVER - SIMPLE AND DIRECT
// ===============================================

function startServer() {
  try {
    const server = app.listen(PORT, '0.0.0.0', () => {
      console.log('✅ SharaSpot Bot Server Started Successfully!');
      console.log(`🌐 Server running at http://0.0.0.0:${PORT}`);
      console.log(`📍 Root endpoint: http://localhost:${PORT}/`);
      console.log(`❤️ Health check: http://localhost:${PORT}/health`);
      console.log(`🪝 Webhook: http://localhost:${PORT}/webhook`);
      console.log('🎉 Ready to receive requests!');
    });

    // Handle server errors
    server.on('error', (error: any) => {
      if (error.code === 'EADDRINUSE') {
        console.error(`💥 Error: Port ${PORT} is already in use`);
        console.error('Try using a different port or kill the process using this port');
      } else {
        console.error('💥 Server error:', error.message);
      }
      process.exit(1);
    });

    // Graceful shutdown
    const gracefulShutdown = (signal: string) => {
      console.log(`🛑 ${signal} received - shutting down gracefully`);
      server.close(() => {
        console.log('✅ Server closed successfully');
        process.exit(0);
      });
    };

    process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
    process.on('SIGINT', () => gracefulShutdown('SIGINT'));
    
    // Handle uncaught exceptions
    process.on('uncaughtException', (error) => {
      console.error('💥 Uncaught Exception:', error.message);
      console.error(error.stack);
      process.exit(1);
    });

    process.on('unhandledRejection', (reason: any) => {
      console.error('💥 Unhandled Rejection:', reason);
      process.exit(1);
    });

  } catch (error: any) {
    console.error('💥 Failed to start server:', error.message);
    process.exit(1);
  }
}

// Start the server
startServer();

// Export for testing
export { app };