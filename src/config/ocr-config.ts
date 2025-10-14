// src/config/ocr-config.ts
export const OCR_CONFIG = {
  // Confidence thresholds
  MIN_OCR_CONFIDENCE: 30,        // Minimum for OCR to succeed
  MIN_DISPLAY_CONFIDENCE: 40,    // Minimum to show to user without warning
  GOOD_CONFIDENCE: 70,           // Good quality threshold
  
  // Attempt limits
  MAX_ATTEMPTS: 3,
  
  // Reading validation
  VALID_RANGE: {
    min: 100,
    max: 99999
  },
  
  MAX_DECIMAL_PLACES: 2,
  
  // Consumption validation
  CONSUMPTION_RANGE: {
    min: 0.1,
    max: 100
  },
  
  // OCR settings
  TESSERACT: {
    language: 'eng',
    whitelist: '0123456789.kKwWhH ',
    psm: 'SPARSE_TEXT' as const
  },
  
  // Preprocessing
  PREPROCESSING: {
    enhanceContrast: true,
    denoise: true,
    targetSize: { width: 1920, height: 1080 }
  },
  
  // State management
  STATE_EXPIRY_MS: 30 * 60 * 1000, // 30 minutes
  
  // User messages
  MESSAGES: {
    LOW_CONFIDENCE_THRESHOLD: 50, // When to suggest retaking
    RETRY_TIPS: {
      lighting: '📸 Ensure better lighting - avoid shadows and glare',
      focus: '🔍 Focus clearly on the kWh display',
      steady: '📱 Hold camera steady and closer to the display',
      visible: '🎯 Make sure the entire kWh reading is visible',
      numbers: '🔢 Ensure numbers are clearly visible and not blurred'
    }
  }
} as const;

export type OCRConfig = typeof OCR_CONFIG;