// src/config/ocr-config.ts - OPTIMIZED FOR PRODUCTION

export const OCR_CONFIG = {
  // ============================================
  // CONFIDENCE THRESHOLDS
  // ============================================
  
  // Minimum confidence for OCR to be considered successful
  // Lowered to 25 because multi-strategy processing can handle lower confidence
  MIN_OCR_CONFIDENCE: 25,
  
  // Minimum confidence to display without warning to user
  // Raised slightly for better UX
  MIN_DISPLAY_CONFIDENCE: 45,
  
  // Threshold for "good quality" reading (no warnings needed)
  GOOD_CONFIDENCE: 75,
  
  // Very high confidence - can skip confirmation step (optional feature)
  EXCELLENT_CONFIDENCE: 90,

  // ============================================
  // ATTEMPT LIMITS
  // ============================================
  
  MAX_ATTEMPTS: 3, // User can try 3 times before manual entry
  
  // Time between retries (prevents spam)
  RETRY_COOLDOWN_MS: 2000, // 2 seconds

  // ============================================
  // READING VALIDATION
  // ============================================
  
  VALID_RANGE: {
    min: 10,      // Lowered from 100 - some meters start low
    max: 999999   // Increased to handle larger cumulative meters
  },
  
  MAX_DECIMAL_PLACES: 3, // Changed from 2 to support more precision
  
  // Anomaly detection - flag readings outside typical range
  TYPICAL_RANGE: {
    min: 100,
    max: 50000
  },

  // ============================================
  // CONSUMPTION VALIDATION
  // ============================================
  
  CONSUMPTION_RANGE: {
    min: 0.5,   // Minimum realistic charge (500Wh)
    max: 150    // Maximum for single session (very high capacity)
  },
  
  // Typical consumption ranges for warnings
  TYPICAL_CONSUMPTION: {
    min: 5,     // Below this = warning
    max: 80     // Above this = warning
  },
  
  // Power validation
  MAX_POWER_EFFICIENCY: 0.95, // 95% charging efficiency
  MIN_POWER_EFFICIENCY: 0.50, // 50% minimum (below = warning)

  // ============================================
  // OCR SETTINGS (TESSERACT)
  // ============================================
  
  TESSERACT: {
    language: 'eng',
    
    // Expanded whitelist for better recognition
    // Includes common OCR mistakes that will be corrected
    whitelist: '0123456789.kKwWhHEeNnRrGgYy :=-',
    
    // PSM (Page Segmentation Mode) - using sparse text for meter displays
    // See: https://tesseract-ocr.github.io/tessdoc/ImproveQuality.html#page-segmentation-method
    psm: 'SPARSE_TEXT' as const,
    
    // Additional Tesseract params
    oem: 'DEFAULT' as const, // OCR Engine Mode
  },

  // ============================================
  // IMAGE PREPROCESSING
  // ============================================
  
  PREPROCESSING: {
    // Standard preprocessing
    enhanceContrast: true,
    denoise: true,
    autoRotate: true,
    threshold: false, // Adaptive thresholding as fallback only
    
    // Target size for OCR (optimal for Tesseract)
    targetSize: { 
      width: 1200,  // Reduced from 1920 for faster processing
      height: 800   // Reduced from 1080
    },
    
    // Aggressive preprocessing (fallback strategy)
    aggressive: {
      contrastBoost: 2.0,
      sharpenSigma: 2.0,
      medianRadius: 5,
      gammaCorrection: 1.2
    },
    
    // Image quality thresholds
    minImageSize: { width: 200, height: 200 },
    maxImageSize: { width: 4000, height: 4000 },
    maxFileSizeMB: 10,
  },

  // ============================================
  // PATTERN MATCHING
  // ============================================
  
  // Keywords that indicate valid meter readings
  METER_KEYWORDS: [
    'KWH', 'KW', 'ENERGY', 'METER', 'READING', 
    'CONSUMPTION', 'DELIVERED', 'TOTAL', 'CUMULATIVE'
  ],
  
  // Common OCR mistakes to correct
  OCR_CORRECTIONS: {
    'O': '0',
    'o': '0',
    'I': '1',
    'l': '1',
    'L': '1',
    'S': '5',
    's': '5',
    'Z': '2',
    'z': '2',
    'B': '8',
    'b': '8',
    'G': '6',
    'g': '6',
  },

  // ============================================
  // STATE MANAGEMENT
  // ============================================
  
  // How long to keep verification state in memory
  STATE_EXPIRY_MS: 30 * 60 * 1000, // 30 minutes
  
  // Cleanup interval for expired states
  CLEANUP_INTERVAL_MS: 5 * 60 * 1000, // 5 minutes
  
  // Maximum concurrent OCR operations
  MAX_CONCURRENT_OCR: 5,

  // ============================================
  // PERFORMANCE & MONITORING
  // ============================================
  
  // OCR timeout (prevent hanging)
  OCR_TIMEOUT_MS: 30000, // 30 seconds
  
  // Processing time thresholds for monitoring
  PERFORMANCE_THRESHOLDS: {
    preprocessing: 3000,   // 3 seconds
    ocrProcessing: 15000,  // 15 seconds
    total: 20000           // 20 seconds
  },
  
  // Enable detailed logging
  ENABLE_DEBUG_LOGS: process.env.NODE_ENV !== 'production',
  
  // Save failed images for analysis (optional)
  SAVE_FAILED_IMAGES: process.env.SAVE_OCR_FAILURES === 'true',
  FAILED_IMAGES_PATH: './failed-ocr-images',

  // ============================================
  // USER MESSAGES
  // ============================================
  
  MESSAGES: {
    // Threshold for suggesting retake
    LOW_CONFIDENCE_THRESHOLD: 50,
    
    // Tips for better photo quality
    RETRY_TIPS: {
      lighting: '💡 Use better lighting - avoid shadows and glare',
      focus: '🔍 Focus clearly on the kWh display numbers',
      steady: '📱 Hold camera steady and move closer to display',
      visible: '🎯 Ensure entire reading is visible in frame',
      numbers: '🔢 Make sure all digits are clear and not blurred',
      angle: '📐 Take photo straight-on, avoid angles',
      background: '🖼️ Minimize background clutter around display',
    },
    
    // Success messages
    SUCCESS: {
      highConfidence: '✅ Reading captured successfully!',
      mediumConfidence: '✅ Reading detected - please verify',
      lowConfidence: '⚠️ Reading detected with low confidence - please check carefully',
    },
    
    // Error messages
    ERRORS: {
      noReading: 'No valid kWh reading found in image',
      lowQuality: 'Image quality too low for accurate reading',
      timeout: 'Processing took too long - please try again',
      invalidReading: 'Reading appears invalid - please verify meter display',
      tooManyAttempts: 'Maximum attempts reached - please enter reading manually',
    },
  },

  // ============================================
  // FALLBACK OPTIONS
  // ============================================
  
  MANUAL_ENTRY: {
    enabled: true,
    minValue: 0,
    maxValue: 999999,
    placeholder: 'e.g., 1234.5',
    validationRegex: /^\d{1,6}(\.\d{1,3})?$/,
  },

  // ============================================
  // FEATURE FLAGS
  // ============================================
  
  FEATURES: {
    // Use multi-strategy preprocessing
    multiStrategyProcessing: true,
    
    // Automatically correct common OCR mistakes
    autoCorrectOCRMistakes: true,
    
    // Use smart candidate ranking
    smartCandidateRanking: true,
    
    // Skip confirmation for excellent confidence
    autoConfirmExcellent: false, // Disabled for safety
    
    // Enable adaptive thresholding fallback
    adaptiveThresholdFallback: true,
    
    // Enable consumption validation with context
    contextualValidation: true,
  },

} as const;

export type OCRConfig = typeof OCR_CONFIG;

// ============================================
// HELPER FUNCTIONS
// ============================================

/**
 * Get confidence level description
 */
export function getConfidenceLevel(confidence: number): 'excellent' | 'good' | 'medium' | 'low' {
  if (confidence >= OCR_CONFIG.EXCELLENT_CONFIDENCE) return 'excellent';
  if (confidence >= OCR_CONFIG.GOOD_CONFIDENCE) return 'good';
  if (confidence >= OCR_CONFIG.MIN_DISPLAY_CONFIDENCE) return 'medium';
  return 'low';
}

/**
 * Check if reading is in typical range
 */
export function isTypicalReading(reading: number): boolean {
  return (
    reading >= OCR_CONFIG.TYPICAL_RANGE.min &&
    reading <= OCR_CONFIG.TYPICAL_RANGE.max
  );
}

/**
 * Check if consumption is typical
 */
export function isTypicalConsumption(consumption: number): boolean {
  return (
    consumption >= OCR_CONFIG.TYPICAL_CONSUMPTION.min &&
    consumption <= OCR_CONFIG.TYPICAL_CONSUMPTION.max
  );
}

/**
 * Get appropriate user message based on confidence
 */
export function getConfidenceMessage(confidence: number): string {
  const level = getConfidenceLevel(confidence);
  return OCR_CONFIG.MESSAGES.SUCCESS[level === 'low' ? 'lowConfidence' : 
         level === 'medium' ? 'mediumConfidence' : 'highConfidence'];
}

/**
 * Validate image file size
 */
export function isValidImageSize(sizeBytes: number): boolean {
  const sizeMB = sizeBytes / (1024 * 1024);
  return sizeMB <= OCR_CONFIG.PREPROCESSING.maxFileSizeMB;
}

/**
 * Check if processing time is acceptable
 */
export function isAcceptableProcessingTime(timeMs: number, stage: keyof typeof OCR_CONFIG.PERFORMANCE_THRESHOLDS): boolean {
  return timeMs <= OCR_CONFIG.PERFORMANCE_THRESHOLDS[stage];
}