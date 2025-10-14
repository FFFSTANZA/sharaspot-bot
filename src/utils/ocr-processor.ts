import Tesseract from 'tesseract.js';
import sharp from 'sharp';

/**
 * OCR Processor for extracting kWh readings from dashboard photos
 * Handles image preprocessing, text extraction, and validation
 */

interface OCRResult {
  success: boolean;
  reading?: number;
  confidence?: number;
  rawText?: string;
  error?: string;
}

interface PreprocessOptions {
  enhanceContrast?: boolean;
  denoise?: boolean;
  targetSize?: { width: number; height: number };
}

/**
 * Main function to extract kWh reading from image buffer
 */
export async function extractKwhReading(
  imageBuffer: Buffer,
  options: PreprocessOptions = {}
): Promise<OCRResult> {
  try {
    // Step 1: Preprocess image for better OCR accuracy
    console.log('🔧 Preprocessing image...');
    const processedImage = await preprocessImage(imageBuffer, options);

    // Step 2: Perform OCR using Tesseract.js
    console.log('🔍 Running OCR...');
    const ocrResult = await performOCR(processedImage);

    if (!ocrResult.success) {
      return {
        success: false,
        error: ocrResult.error || 'OCR processing failed',
      };
    }

    // Step 3: Extract kWh reading from text
    console.log('📊 Extracting kWh reading...');
    const reading = extractReadingFromText(ocrResult.text || '');

    if (!reading) {
      return {
        success: false,
        rawText: ocrResult.text,
        error: 'Could not find kWh reading in image',
      };
    }

    // Step 4: Validate the reading
    const validation = validateReading(reading);
    if (!validation.valid) {
      return {
        success: false,
        reading,
        error: validation.error,
      };
    }

    return {
      success: true,
      reading,
      confidence: ocrResult.confidence,
      rawText: ocrResult.text,
    };
  } catch (error) {
    console.error('❌ OCR processing error:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error occurred',
    };
  }
}

/**
 * Preprocess image to enhance OCR accuracy
 */
export async function preprocessImage(
  imageBuffer: Buffer,
  options: PreprocessOptions = {}
): Promise<Buffer> {
  try {
    const {
      enhanceContrast = true,
      denoise = true,
      targetSize = { width: 1920, height: 1080 },
    } = options;

    let processor = sharp(imageBuffer);

    // Resize if image is too large (improves processing speed)
    const metadata = await processor.metadata();
    if (metadata.width && metadata.width > targetSize.width) {
      processor = processor.resize(targetSize.width, targetSize.height, {
        fit: 'inside',
        withoutEnlargement: true,
      });
    }

    // Convert to grayscale for better text recognition
    processor = processor.grayscale();

    // Enhance contrast to make text clearer
    if (enhanceContrast) {
      processor = processor.normalize();
    }

    // Apply sharpening to improve edge detection
    processor = processor.sharpen();

    // Denoise if enabled
    if (denoise) {
      processor = processor.median(3); // Median filter for noise reduction
    }

    // Increase contrast further using levels
    processor = processor.linear(1.5, -(128 * 1.5) + 128);

    // Convert to high-quality PNG for Tesseract
    const processedBuffer = await processor.png().toBuffer();

    console.log('✅ Image preprocessing complete');
    return processedBuffer;
  } catch (error) {
    console.error('❌ Image preprocessing failed:', error);
    throw new Error('Failed to preprocess image: ' + (error instanceof Error ? error.message : 'Unknown error'));
  }
}

/**
 * Perform OCR using Tesseract.js
 */
async function performOCR(imageBuffer: Buffer): Promise<{
  success: boolean;
  text?: string;
  confidence?: number;
  error?: string;
}> {
  try {
    const worker = await Tesseract.createWorker('eng', 1, {
      logger: (m) => {
        if (m.status === 'recognizing text') {
          console.log(`OCR Progress: ${Math.round(m.progress * 100)}%`);
        }
      },
    });

    // Configure Tesseract for number recognition
    await worker.setParameters({
      tessedit_char_whitelist: '0123456789.kKwWhH ',
      tessedit_pageseg_mode: Tesseract.PSM.SPARSE_TEXT,
    });

    const result = await worker.recognize(imageBuffer);
    await worker.terminate();

    const confidence = result.data.confidence;
    const text = result.data.text.trim();

    console.log('📝 OCR Raw Text:', text);
    console.log('📊 OCR Confidence:', confidence);

    if (confidence < 30) {
      return {
        success: false,
        error: 'Low confidence OCR result. Please retake photo with better lighting and focus.',
      };
    }

    return {
      success: true,
      text,
      confidence,
    };
  } catch (error) {
    console.error('❌ Tesseract OCR failed:', error);
    return {
      success: false,
      error: 'OCR engine error: ' + (error instanceof Error ? error.message : 'Unknown error'),
    };
  }
}

/**
 * Extract numeric kWh reading from OCR text
 * Handles various formats: "1245.8", "1245.8 kWh", "kWh: 1245.8", etc.
 */
function extractReadingFromText(text: string): number | null {
  // Clean up text
  const cleanText = text
    .toUpperCase()
    .replace(/\s+/g, ' ')
    .trim();

  console.log('🔍 Cleaned text:', cleanText);

  // Pattern 1: Look for numbers followed by kWh (e.g., "1245.8 kWh")
  const pattern1 = /(\d+\.?\d*)\s*K?W?H?/i;
  const match1 = cleanText.match(pattern1);
  if (match1 && match1[1]) {
    const reading = parseFloat(match1[1]);
    if (!isNaN(reading)) {
      console.log('✅ Found reading (Pattern 1):', reading);
      return reading;
    }
  }

  // Pattern 2: Look for standalone decimal numbers (e.g., "1245.8")
  const pattern2 = /(\d{3,5}\.\d{1,2})/;
  const match2 = cleanText.match(pattern2);
  if (match2 && match2[1]) {
    const reading = parseFloat(match2[1]);
    if (!isNaN(reading)) {
      console.log('✅ Found reading (Pattern 2):', reading);
      return reading;
    }
  }

  // Pattern 3: Look for any number with 3-5 digits before decimal
  const pattern3 = /(\d{3,5})\s*\.?\s*(\d{1,2})?/;
  const match3 = cleanText.match(pattern3);
  if (match3) {
    const intPart = match3[1];
    const decPart = match3[2] || '0';
    const reading = parseFloat(`${intPart}.${decPart}`);
    if (!isNaN(reading)) {
      console.log('✅ Found reading (Pattern 3):', reading);
      return reading;
    }
  }

  // Pattern 4: Extract all numbers and find the most likely candidate
  const allNumbers = cleanText.match(/\d+\.?\d*/g);
  if (allNumbers && allNumbers.length > 0) {
    // Filter numbers that could be kWh readings (between 100 and 99999)
    const candidates = allNumbers
      .map(n => parseFloat(n))
      .filter(n => !isNaN(n) && n >= 100 && n <= 99999);
    
    if (candidates.length === 1) {
      console.log('✅ Found reading (Pattern 4):', candidates[0]);
      return candidates[0];
    } else if (candidates.length > 1) {
      // Return the largest number (most likely to be cumulative kWh)
      const reading = Math.max(...candidates);
      console.log('✅ Found reading (Pattern 4 - max):', reading);
      return reading;
    }
  }

  console.log('❌ No valid kWh reading found in text');
  return null;
}

/**
 * Validate extracted reading
 */
export function validateReading(reading: number): {
  valid: boolean;
  error?: string;
} {
  // Check if reading is a valid number
  if (isNaN(reading) || !isFinite(reading)) {
    return {
      valid: false,
      error: 'Invalid reading: Not a valid number',
    };
  }

  // Check if reading is positive
  if (reading <= 0) {
    return {
      valid: false,
      error: 'Invalid reading: Must be greater than 0',
    };
  }

  // Check reasonable range for meter readings (100 - 99,999 kWh)
  // Most charging station meters start at 0 and go up to 99,999
  if (reading < 100) {
    return {
      valid: false,
      error: 'Reading too low: Meter readings are typically above 100 kWh',
    };
  }

  if (reading > 99999) {
    return {
      valid: false,
      error: 'Reading too high: Please verify the reading',
    };
  }

  // Check decimal places (max 2)
  const decimalPlaces = (reading.toString().split('.')[1] || '').length;
  if (decimalPlaces > 2) {
    return {
      valid: false,
      error: 'Invalid reading: Too many decimal places',
    };
  }

  return {
    valid: true,
  };
}

/**
 * Calculate consumption between two readings with validation
 */
export function calculateConsumption(
  startReading: number,
  endReading: number
): {
  valid: boolean;
  consumption?: number;
  error?: string;
} {
  // Validate both readings
  const startValidation = validateReading(startReading);
  if (!startValidation.valid) {
    return {
      valid: false,
      error: `Invalid start reading: ${startValidation.error}`,
    };
  }

  const endValidation = validateReading(endReading);
  if (!endValidation.valid) {
    return {
      valid: false,
      error: `Invalid end reading: ${endValidation.error}`,
    };
  }

  // Check 1: End reading must be greater than start
  if (endReading <= startReading) {
    return {
      valid: false,
      error: 'End reading must be greater than start reading',
    };
  }

  const consumption = endReading - startReading;

  // Check 2: Reasonable consumption range (0.1 - 100 kWh per session)
  if (consumption < 0.1) {
    return {
      valid: false,
      error: 'Consumption too low: Minimum 0.1 kWh',
    };
  }

  if (consumption > 100) {
    return {
      valid: false,
      error: 'Consumption exceeds typical maximum (100 kWh). Please verify readings.',
    };
  }

  return {
    valid: true,
    consumption: Math.round(consumption * 100) / 100, // Round to 2 decimal places
  };
}

/**
 * Validate consumption against session duration and charger specs
 */
export function validateConsumptionWithContext(
  consumption: number,
  durationMinutes: number,
  chargerPowerKw: number,
  batteryCapacityKwh?: number
): {
  valid: boolean;
  warnings?: string[];
  error?: string;
} {
  const warnings: string[] = [];

  // Check 3: Duration match (physics check)
  const durationHours = durationMinutes / 60;
  const maxPossibleKwh = durationHours * chargerPowerKw * 0.9; // 90% efficiency
  
  if (consumption > maxPossibleKwh * 1.1) { // 10% tolerance
    return {
      valid: false,
      error: `Consumption (${consumption} kWh) exceeds maximum possible (${maxPossibleKwh.toFixed(1)} kWh) for ${durationMinutes} min at ${chargerPowerKw} kW`,
    };
  }

  // Check 4: Battery capacity validation
  if (batteryCapacityKwh && consumption > batteryCapacityKwh) {
    return {
      valid: false,
      error: `Consumption (${consumption} kWh) exceeds vehicle battery capacity (${batteryCapacityKwh} kWh)`,
    };
  }

  // Warning: Very low efficiency
  const efficiency = (consumption / (durationHours * chargerPowerKw)) * 100;
  if (efficiency < 50) {
    warnings.push(`Low charging efficiency (${efficiency.toFixed(0)}%). This may be normal for small top-ups.`);
  }

  // Warning: Suspiciously high consumption rate
  const averageKw = consumption / durationHours;
  if (averageKw > chargerPowerKw * 0.95) {
    warnings.push(`Very high charging rate (${averageKw.toFixed(1)} kW average). Please verify readings.`);
  }

  return {
    valid: true,
    warnings: warnings.length > 0 ? warnings : undefined,
  };
}

/**
 * Helper: Format reading for display
 */
export function formatReading(reading: number): string {
  return `${reading.toFixed(1)} kWh`;
}

/**
 * Helper: Get retry suggestions based on OCR failure
 */
export function getRetrySuggestions(confidence?: number, rawText?: string): string[] {
  const suggestions: string[] = [];

  if (!confidence || confidence < 50) {
    suggestions.push('📸 Ensure better lighting - avoid shadows and glare');
    suggestions.push('🔍 Focus clearly on the kWh display');
    suggestions.push('📱 Hold camera steady and closer to the display');
  }

  if (rawText && rawText.length < 5) {
    suggestions.push('🎯 Make sure the entire kWh reading is visible');
    suggestions.push('🔢 Ensure numbers are clearly visible and not blurred');
  }

  if (suggestions.length === 0) {
    suggestions.push('📸 Retake photo with better angle and lighting');
    suggestions.push('🔍 Ensure the display shows the kWh reading clearly');
  }

  return suggestions;
}

export default {
  extractKwhReading,
  preprocessImage,
  validateReading,
  calculateConsumption,
  validateConsumptionWithContext,
  formatReading,
  getRetrySuggestions,
};