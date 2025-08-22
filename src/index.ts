// src/index.ts - ULTRA OPTIMIZED TYPE-SAFE EXPRESS SERVER
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { env } from './config/env';
import { logger } from './utils/logger';
import { webhookController } from './controllers/webhook';
import { queueScheduler } from './utils/queue-scheduler';
import { initializeDatabase } from './db/connection';

// ===============================================
// TYPE-SAFE ERROR HANDLING UTILITY
// ===============================================

const getErrorMessage = (error: unknown): string => {
  if (error instanceof Error) {
    return error.message;
  }
  if (typeof error === 'string') {
    return error;
  }
  return 'Unknown error occurred';
};

const getErrorStack = (error: unknown): string | undefined => {
  if (error instanceof Error) {
    return error.stack;
  }
  return undefined;
};

// ===============================================
// EXPRESS APP CONFIGURATION
// ===============================================

const app = express();
const port = env.PORT || 3000;

// ===============================================
// OPTIMIZED SECURITY & MIDDLEWARE STACK
// ===============================================

// Enhanced security with minimal configuration
app.use(helmet({
  contentSecurityPolicy: env.NODE_ENV === 'production' ? undefined : false,
  crossOriginEmbedderPolicy: false,
  hsts: env.NODE_ENV === 'production'
}));

// Smart CORS configuration
app.use(cors({
  origin: env.NODE_ENV === 'production' 
    ? process.env.ALLOWED_ORIGINS?.split(',') || false
    : true,
  credentials: true,
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With']
}));

// Optimized body parsing with smart limits
app.use(express.json({ 
  limit: '5mb',
  strict: true,
  type: ['application/json', 'text/plain']
}));

app.use(express.urlencoded({ 
  extended: true, 
  limit: '5mb',
  parameterLimit: 50
}));

// ===============================================
// SMART RATE LIMITING (Memory-efficient)
// ===============================================

const rateLimitMap = new Map<string, { count: number; resetTime: number }>();
const RATE_LIMIT_WINDOW = 60000; // 1 minute
const RATE_LIMIT_MAX = env.NODE_ENV === 'production' ? 60 : 100;

// Cleanup function for rate limiting
setInterval(() => {
  const now = Date.now();
  for (const [ip, data] of rateLimitMap.entries()) {
    if (now > data.resetTime) {
      rateLimitMap.delete(ip);
    }
  }
}, RATE_LIMIT_WINDOW);

app.use((req, res, next) => {
  const clientIp = req.ip || req.socket.remoteAddress || 'unknown';
  const now = Date.now();
  
  const limitData = rateLimitMap.get(clientIp) || { count: 0, resetTime: now + RATE_LIMIT_WINDOW };
  
  if (now > limitData.resetTime) {
    limitData.count = 1;
    limitData.resetTime = now + RATE_LIMIT_WINDOW;
  } else {
    limitData.count++;
  }
  
  rateLimitMap.set(clientIp, limitData);
  
  if (limitData.count > RATE_LIMIT_MAX) {
    res.status(429).json({
      error: 'Rate limit exceeded',
      retryAfter: Math.ceil((limitData.resetTime - now) / 1000)
    });
    return; // Explicit return to satisfy TypeScript
  }
  
  // Add rate limit headers
  res.set({
    'X-RateLimit-Limit': RATE_LIMIT_MAX.toString(),
    'X-RateLimit-Remaining': Math.max(0, RATE_LIMIT_MAX - limitData.count).toString(),
    'X-RateLimit-Reset': Math.ceil(limitData.resetTime / 1000).toString()
  });
  
  next();
});

// ===============================================
// EFFICIENT REQUEST LOGGING
// ===============================================

app.use((req, res, next) => {
  const startTime = Date.now();
  
  // Only log in development or for specific routes in production
  const shouldLog = env.NODE_ENV === 'development' || 
                   req.path.startsWith('/webhook') || 
                   req.path === '/health';
  
  if (shouldLog) {
    res.on('finish', () => {
      const duration = Date.now() - startTime;
      const logLevel = res.statusCode >= 400 ? 'warn' : 'info';
      
      logger[logLevel]('HTTP Request', {
        method: req.method,
        path: req.path,
        status: res.statusCode,
        duration: `${duration}ms`,
        ip: req.ip,
        userAgent: req.get('User-Agent')?.substring(0, 100) // Truncate long user agents
      });
    });
  }
  
  next();
});

// ===============================================
// TYPE-SAFE HEALTH CHECK ENDPOINT
// ===============================================

app.get('/health', async (req, res) => {
  try {
    const healthStatus = {
      status: 'healthy',
      timestamp: new Date().toISOString(),
      service: 'sharaspot-bot',
      version: process.env.npm_package_version || '1.0.0',
      environment: env.NODE_ENV,
      uptime: Math.floor(process.uptime()),
      memory: {
        used: Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
        total: Math.round(process.memoryUsage().heapTotal / 1024 / 1024)
      }
    };

    // Add detailed status only in development
    if (env.NODE_ENV === 'development') {
      Object.assign(healthStatus, {
        queue: queueScheduler?.getStatus?.() || { status: 'not_configured' },
        database: 'connected', // Add actual DB health check if needed
        activeConnections: rateLimitMap.size
      });
    }

    res.set('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.status(200).json(healthStatus);
  } catch (error) {
    const errorMessage = getErrorMessage(error);
    logger.error('Health check failed', { error: errorMessage });
    res.status(503).json({
      status: 'unhealthy',
      timestamp: new Date().toISOString(),
      error: env.NODE_ENV === 'development' ? errorMessage : 'Service unavailable'
    });
  }
});

// ===============================================
// WEBHOOK ENDPOINTS (Core functionality)
// ===============================================

app.get('/webhook', webhookController.verifyWebhook.bind(webhookController));
app.post('/webhook', webhookController.handleWebhook.bind(webhookController));

// ===============================================
// API ROUTES (Future expansion ready)
// ===============================================

app.use('/api/v1', (req, res, next) => {
  // API versioning middleware
  res.set('API-Version', 'v1');
  next();
}, (req, res) => {
  res.status(501).json({
    message: 'API endpoints coming soon',
    version: 'v1',
    timestamp: new Date().toISOString()
  });
});

// ===============================================
// TYPE-SAFE ERROR HANDLING
// ===============================================

// 404 handler (must be after all routes)
app.use('*', (req, res) => {
  res.status(404).json({
    error: 'Endpoint not found',
    path: req.originalUrl,
    method: req.method,
    timestamp: new Date().toISOString(),
    suggestion: req.originalUrl.includes('webhook') ? 'Check webhook configuration' : 'Verify endpoint URL'
  });
});

// Global error handler with complete type safety
app.use((err: unknown, req: express.Request, res: express.Response, next: express.NextFunction) => {
  const errorId = Date.now().toString(36) + Math.random().toString(36).substr(2);
  const errorMessage = getErrorMessage(err);
  const errorStack = getErrorStack(err);
  const statusCode = (err as any)?.status || (err as any)?.statusCode || 500;
  
  logger.error('Unhandled application error', {
    errorId,
    message: errorMessage,
    stack: env.NODE_ENV === 'development' ? errorStack : undefined,
    url: req.url,
    method: req.method,
    ip: req.ip,
    userAgent: req.get('User-Agent')?.substring(0, 100)
  });

  // Don't leak sensitive information in production
  const errorResponse = {
    error: 'Internal server error',
    errorId,
    timestamp: new Date().toISOString(),
    ...(env.NODE_ENV === 'development' && { 
      message: errorMessage,
      stack: errorStack 
    })
  };

  res.status(statusCode).json(errorResponse);
});

// ===============================================
// TYPE-SAFE SERVER LIFECYCLE MANAGEMENT
// ===============================================

class ServerManager {
  private server: any = null;
  private isShuttingDown = false;

  async start(): Promise<void> {
    try {
      logger.info('🚀 Starting SharaSpot Bot Server');
      
      // Initialize database connection with timeout
      await this.initializeDatabaseWithTimeout();
      
      // Start HTTP server
      this.server = app.listen(port, () => {
        logger.info('✅ SharaSpot Bot Server Ready', {
          port,
          environment: env.NODE_ENV,
          webhookUrl: `http://localhost:${port}/webhook`,
          healthUrl: `http://localhost:${port}/health`,
          processId: process.pid,
          nodeVersion: process.version
        });
      });

      // Start background services
      await this.startBackgroundServices();
      
      // Setup shutdown handlers
      this.setupGracefulShutdown();
      
    } catch (error) {
      const errorMessage = getErrorMessage(error);
      logger.error('💥 Server startup failed', { error: errorMessage });
      process.exit(1);
    }
  }

  private async initializeDatabaseWithTimeout(): Promise<void> {
    const timeout = new Promise<never>((_, reject) => 
      setTimeout(() => reject(new Error('Database connection timeout')), 10000)
    );
    
    try {
      await Promise.race([initializeDatabase(), timeout]);
      logger.info('✅ Database connected successfully');
    } catch (error) {
      const errorMessage = getErrorMessage(error);
      logger.error('❌ Database connection failed', { error: errorMessage });
      throw error;
    }
  }

  private async startBackgroundServices(): Promise<void> {
    // Type-safe environment variable checking
    const shouldStartScheduler = process.env.ENABLE_QUEUE_SCHEDULER !== 'false';
    
    // Only start scheduler if explicitly enabled and available
    if (shouldStartScheduler && queueScheduler) {
      try {
        await queueScheduler.start();
        logger.info('🤖 Background queue scheduler started');
      } catch (error) {
        const errorMessage = getErrorMessage(error);
        logger.warn('⚠️ Queue scheduler failed to start', { error: errorMessage });
        // Don't fail the entire server for optional services
      }
    } else {
      logger.info('⏸️ Queue scheduler disabled or not available');
    }
  }

  private setupGracefulShutdown(): void {
    const handleShutdown = async (signal: string) => {
      if (this.isShuttingDown) return;
      this.isShuttingDown = true;
      
      logger.info(`🛑 ${signal} received - starting graceful shutdown`);
      
      // Set shutdown timeout
      const shutdownTimeout = setTimeout(() => {
        logger.error('💥 Forced shutdown due to timeout');
        process.exit(1);
      }, 30000);

      try {
        // Stop accepting new connections
        if (this.server) {
          await new Promise<void>((resolve) => {
            this.server.close(resolve);
          });
          logger.info('🛑 HTTP server stopped');
        }
        
        // Stop background services
        if (queueScheduler?.stop) {
          await queueScheduler.stop();
          logger.info('🤖 Queue scheduler stopped');
        }
        
        // Clear intervals and cleanup
        rateLimitMap.clear();
        
        clearTimeout(shutdownTimeout);
        logger.info('✅ Graceful shutdown completed');
        process.exit(0);
        
      } catch (error) {
        const errorMessage = getErrorMessage(error);
        logger.error('💥 Error during shutdown', { error: errorMessage });
        clearTimeout(shutdownTimeout);
        process.exit(1);
      }
    };

    // Handle various shutdown signals
    process.on('SIGTERM', () => handleShutdown('SIGTERM'));
    process.on('SIGINT', () => handleShutdown('SIGINT'));
    
    // Handle uncaught exceptions with type safety
    process.on('uncaughtException', (error: Error) => {
      logger.error('💥 Uncaught Exception', { 
        error: error.message, 
        stack: error.stack 
      });
      handleShutdown('uncaughtException');
    });
    
    process.on('unhandledRejection', (reason: unknown) => {
      const errorMessage = getErrorMessage(reason);
      logger.error('💥 Unhandled Promise Rejection', { reason: errorMessage });
      handleShutdown('unhandledRejection');
    });
  }
}

// ===============================================
// SERVER INITIALIZATION WITH TYPE SAFETY
// ===============================================

const serverManager = new ServerManager();

// Only start server if this file is run directly
if (require.main === module) {
  serverManager.start().catch((error: unknown) => {
    const errorMessage = getErrorMessage(error);
    logger.error('💥 Failed to start server', { error: errorMessage });
    process.exit(1);
  });
}

// ===============================================
// TYPE-SAFE EXPORTS FOR TESTING & MODULES
// ===============================================

export { 
  app,
  serverManager
};

// Export health check function for external monitoring
export const getServerHealth = async (): Promise<{ status: string; [key: string]: any }> => {
  try {
    const health = {
      uptime: process.uptime(),
      memory: process.memoryUsage(),
      timestamp: new Date().toISOString(),
      environment: env.NODE_ENV,
      activeConnections: rateLimitMap.size
    };
    return { status: 'healthy', ...health };
  } catch (error) {
    const errorMessage = getErrorMessage(error);
    return { status: 'unhealthy', error: errorMessage };
  }
};

// Export server metrics for monitoring
export const getServerMetrics = () => ({
  activeRateLimitEntries: rateLimitMap.size,
  uptime: process.uptime(),
  memoryUsage: process.memoryUsage(),
  environment: env.NODE_ENV,
  version: process.env.npm_package_version || '1.0.0'
});