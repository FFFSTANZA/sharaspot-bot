// ocr-processor.ts

import Tesseract from 'tesseract.js';
import sharp from 'sharp';
import { OCR_CONFIG } from '../config/ocr-config';

// ======================
// Interfaces
// ======================

export interface OCRResult {
  success: boolean;
  reading?: number;
  confidence?: number;
  rawText?: string;
  error?: string;
  suggestions?: string[];
}

export interface PreprocessOptions {
  enhanceContrast?: boolean;
  denoise?: boolean;
  targetSize?: { width: number; height: number };
}

interface OCRRawResult {
  success: boolean;
  text?: string;
  confidence?: number;
  error?: string;
}

// ======================
// Main Function
// ======================

/**
 * Extract kWh reading from image buffer with preprocessing, OCR, and validation
 */
export async function extractKwhReading(
  imageBuffer: Buffer,
  options: PreprocessOptions = OCR_CONFIG.PREPROCESSING
): Promise<OCRResult> {
  try {
    const processedImage = await preprocessImage(imageBuffer, options);
    const ocrResult = await performOCR(processedImage);

    if (!ocrResult.success) {
      return {
        success: false,
        error: ocrResult.error || 'OCR failed',
        suggestions: getRetrySuggestions(ocrResult.confidence, ocrResult.text),
      };
    }

    const reading = extractReadingFromText(ocrResult.text || '');
    if (reading === null) {
      return {
        success: false,
        rawText: ocrResult.text,
        error: 'No valid kWh reading found',
        suggestions: getRetrySuggestions(ocrResult.confidence, ocrResult.text),
      };
    }

    const validation = validateReading(reading);
    if (!validation.valid) {
      return {
        success: false,
        reading,
        error: validation.error,
        suggestions: getRetrySuggestions(ocrResult.confidence, ocrResult.text),
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
      error: error instanceof Error ? error.message : 'Unknown error',
      suggestions: getRetrySuggestions(),
    };
  }
}

// ======================
// Image Preprocessing
// ======================

export async function preprocessImage(
  imageBuffer: Buffer,
  options: PreprocessOptions = OCR_CONFIG.PREPROCESSING
): Promise<Buffer> {
  try {
    const {
      enhanceContrast = OCR_CONFIG.PREPROCESSING.enhanceContrast,
      denoise = OCR_CONFIG.PREPROCESSING.denoise,
      targetSize = OCR_CONFIG.PREPROCESSING.targetSize,
    } = options;

    let processor = sharp(imageBuffer);

    // Metadata for conditional resize
    const metadata = await processor.metadata();
    const shouldResize = metadata.width && metadata.width > targetSize.width;

    if (shouldResize) {
      processor = processor.resize(targetSize.width, targetSize.height, {
        fit: 'inside',
        withoutEnlargement: true,
      });
    }

    processor = processor
      .grayscale()
      .sharpen();

    if (enhanceContrast) {
      processor = processor.normalize();
    }

    if (denoise) {
      processor = processor.median(3);
    }

    // Boost contrast for Tesseract
    processor = processor.linear(1.8, -100); // Aggressive contrast

    // Output as PNG (lossless)
    const result = await processor.png({ quality: 100 }).toBuffer();
    console.log('✅ Preprocessing complete');
    return result;
  } catch (error) {
    console.error('❌ Preprocessing failed:', error);
    throw new Error(`Preprocessing failed: ${error instanceof Error ? error.message : 'Unknown'}`);
  }
}

// ======================
// OCR Execution
// ======================

async function performOCR(imageBuffer: Buffer): Promise<OCRRawResult> {
  let worker: Tesseract.Worker | null = null;
  try {
    worker = await Tesseract.createWorker(OCR_CONFIG.TESSERACT.language, 1, {
      logger: (m) => {
        if (m.status === 'recognizing text') {
          console.log(`OCR Progress: ${Math.round(m.progress * 100)}%`);
        }
      },
    });

    await worker.setParameters({
      tessedit_char_whitelist: OCR_CONFIG.TESSERACT.whitelist,
      tessedit_pageseg_mode: Tesseract.PSM.SINGLE_BLOCK,
      preserve_interword_spaces: '1',
    });

    const result = await worker.recognize(imageBuffer);
    await worker.terminate();

    const { text, confidence } = result.data;
    const cleanText = text.trim();

    if (confidence < OCR_CONFIG.MIN_OCR_CONFIDENCE) {
      return {
        success: false,
        error: 'Low-confidence OCR result',
        confidence,
        text: cleanText,
      };
    }

    return {
      success: true,
      text: cleanText,
      confidence,
    };
  } catch (error) {
    console.error('❌ Tesseract error:', error);
    return {
      success: false,
      error: `Tesseract error: ${error instanceof Error ? error.message : 'Unknown'}`,
    };
  } finally {
    if (worker) {
      try {
        await worker.terminate();
      } catch (e) {
        console.warn('Worker termination warning:', e);
      }
    }
  }
}

// ======================
// Reading Extraction
// ======================

function extractReadingFromText(text: string): number | null {
  const clean = text
    .replace(/[\n\r\t]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toUpperCase();

  console.log('🔍 Cleaned OCR text:', JSON.stringify(clean));

  // Pattern: [optional prefix] NUMBER [optional kWh/kW/kWh]
  const patterns = [
    /(?:K?W?H?\s*[:\-]?\s*)?(\d{3,6}(?:\.\d{1,3})?)/i,
    /(\d{3,6}(?:\.\d{1,3})?)\s*(?:K?W?H?)/i,
  ];

  for (const pattern of patterns) {
    const match = clean.match(pattern);
    if (match && match[1]) {
      const num = parseFloat(match[1]);
      if (!isNaN(num) && num >= OCR_CONFIG.VALID_RANGE.min && num <= OCR_CONFIG.VALID_RANGE.max) {
        console.log('✅ Reading matched pattern:', num);
        return num;
      }
    }
  }

  // Fallback: extract all numbers and find plausible candidate
  const allNums = clean.match(/\d+(?:\.\d+)?/g);
  if (allNums) {
    const candidates = allNums
      .map(n => parseFloat(n))
      .filter(n => !isNaN(n) && n >= OCR_CONFIG.VALID_RANGE.min && n <= OCR_CONFIG.VALID_RANGE.max);

    if (candidates.length === 1) return candidates[0];
    if (candidates.length > 1) return Math.max(...candidates); // Assume cumulative meter
  }

  console.log('❌ No valid kWh reading found');
  return null;
}

// ======================
// Validation
// ======================

export function validateReading(reading: number): { valid: boolean; error?: string } {
  if (typeof reading !== 'number' || isNaN(reading) || !isFinite(reading)) {
    return { valid: false, error: 'Invalid number format' };
  }
  if (reading <= 0) {
    return { valid: false, error: 'Reading must be positive' };
  }
  if (reading < OCR_CONFIG.VALID_RANGE.min) {
    return { valid: false, error: `Reading below minimum (${OCR_CONFIG.VALID_RANGE.min} kWh)` };
  }
  if (reading > OCR_CONFIG.VALID_RANGE.max) {
    return { valid: false, error: `Reading exceeds maximum (${OCR_CONFIG.VALID_RANGE.max} kWh)` };
  }
  const decimals = (reading.toString().split('.')[1] || '').length;
  if (decimals > OCR_CONFIG.MAX_DECIMAL_PLACES) {
    return { valid: false, error: 'Too many decimal places' };
  }
  return { valid: true };
}

// ======================
// Consumption Logic
// ======================

export function calculateConsumption(
  start: number,
  end: number
): { valid: boolean; consumption?: number; error?: string } {
  const v1 = validateReading(start);
  const v2 = validateReading(end);
  if (!v1.valid) return { valid: false, error: `Start: ${v1.error}` };
  if (!v2.valid) return { valid: false, error: `End: ${v2.error}` };
  if (end <= start) {
    return { valid: false, error: 'End reading must be greater than start' };
  }

  const cons = end - start;
  if (cons < OCR_CONFIG.CONSUMPTION_RANGE.min) {
    return { valid: false, error: `Consumption too low (< ${OCR_CONFIG.CONSUMPTION_RANGE.min} kWh)` };
  }
  if (cons > OCR_CONFIG.CONSUMPTION_RANGE.max) {
    return { valid: false, error: `Consumption too high (> ${OCR_CONFIG.CONSUMPTION_RANGE.max} kWh)` };
  }

  return {
    valid: true,
    consumption: Math.round(cons * 100) / 100,
  };
}

export function validateConsumptionWithContext(
  consumption: number,
  durationMinutes: number,
  chargerPowerKw: number,
  batteryCapacityKwh?: number
): { valid: boolean; warnings?: string[]; error?: string } {
  const durationHours = durationMinutes / 60;
  const theoreticalMax = durationHours * chargerPowerKw * 0.95; // assume 95% efficiency

  if (consumption > theoreticalMax * 1.15) {
    return {
      valid: false,
      error: `Consumption (${consumption} kWh) exceeds theoretical max (${theoreticalMax.toFixed(1)} kWh)`,
    };
  }

  if (batteryCapacityKwh && consumption > batteryCapacityKwh * 1.05) {
    return {
      valid: false,
      error: `Consumption exceeds battery capacity (${batteryCapacityKwh} kWh)`,
    };
  }

  const warnings: string[] = [];
  const avgPower = consumption / durationHours;
  if (avgPower > chargerPowerKw * 0.98) {
    warnings.push('Average power very close to charger limit – verify readings.');
  }

  const efficiency = (consumption / (durationHours * chargerPowerKw)) * 100;
  if (efficiency < 60) {
    warnings.push(`Low efficiency (${efficiency.toFixed(0)}%) – may indicate partial charge.`);
  }

  return { valid: true, warnings: warnings.length ? warnings : undefined };
}

// ======================
// Helpers
// ======================

export function formatReading(reading: number): string {
  return `${reading.toFixed(1)} kWh`;
}

export function getRetrySuggestions(confidence?: number, rawText?: string): string[] {
  const tips = OCR_CONFIG.MESSAGES.RETRY_TIPS;
  const suggestions: string[] = [];

  if (confidence === undefined || confidence < OCR_CONFIG.MESSAGES.LOW_CONFIDENCE_THRESHOLD) {
    suggestions.push(tips.lighting, tips.focus, tips.steady);
  }

  if (!rawText || rawText.replace(/\D/g, '').length < 3) {
    suggestions.push(tips.visible, tips.numbers);
  }

  return [...new Set(suggestions)]; // dedupe
}

export function shouldWarnLowConfidence(confidence: number): boolean {
  return confidence < OCR_CONFIG.MIN_DISPLAY_CONFIDENCE;
}

export function isGoodConfidence(confidence: number): boolean {
  return confidence >= OCR_CONFIG.GOOD_CONFIDENCE;
}

// ======================
// Export
// ======================

export default {
  extractKwhReading,
  preprocessImage,
  validateReading,
  calculateConsumption,
  validateConsumptionWithContext,
  formatReading,
  getRetrySuggestions,
  shouldWarnLowConfidence,
  isGoodConfidence,
};