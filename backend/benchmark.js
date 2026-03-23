/**
 * RAW Processing Performance Benchmark
 * So sánh FFmpeg vs các giải pháp tối ưu
 */

const ffmpeg = require('fluent-ffmpeg');
const ffmpegStatic = require('ffmpeg-static');
const sharp = require('sharp');
const fs = require('fs').promises;
const path = require('path');

ffmpeg.setFfmpegPath(ffmpegStatic);

const UPLOAD_DIR = process.env.UPLOAD_FOLDER || './uploads';

/**
 * Test 1: Current FFmpeg approach (900x900, -q:v 5)
 */
async function benchmarkFFmpegCurrent(inputFile) {
  return new Promise((resolve, reject) => {
    const startTime = Date.now();
    const outputFile = `./benchmark-output-current-${Date.now()}.jpg`;
    const ffmpegInput = inputFile.replace(/\\/g, '/');
    const ffmpegOutput = outputFile.replace(/\\/g, '/');

    console.log('🔵 [Test 1] FFmpeg Current (900x900, -q:v 5)');
    
    ffmpeg(ffmpegInput)
      .output(ffmpegOutput)
      .outputOptions([
        '-vf', 'scale=900:900:force_original_aspect_ratio=decrease',
        '-q:v', '5'
      ])
      .on('end', () => {
        const duration = Date.now() - startTime;
        console.log(`   ✓ Done in ${duration}ms`);
        resolve(duration);
      })
      .on('error', (err) => {
        console.log(`   ✗ Error: ${err.message}`);
        reject(err);
      })
      .run();
  });
}

/**
 * Test 2: FFmpeg optimized (600x600, -q:v 8)
 */
async function benchmarkFFmpegOptimized(inputFile) {
  return new Promise((resolve, reject) => {
    const startTime = Date.now();
    const outputFile = `./benchmark-output-optimized-${Date.now()}.jpg`;
    const ffmpegInput = inputFile.replace(/\\/g, '/');
    const ffmpegOutput = outputFile.replace(/\\/g, '/');

    console.log('🟢 [Test 2] FFmpeg Optimized (600x600, -q:v 8)');
    
    ffmpeg(ffmpegInput)
      .output(ffmpegOutput)
      .outputOptions([
        '-vf', 'scale=600:600:force_original_aspect_ratio=decrease',
        '-q:v', '8'
      ])
      .on('end', () => {
        const duration = Date.now() - startTime;
        console.log(`   ✓ Done in ${duration}ms`);
        resolve(duration);
      })
      .on('error', (err) => {
        console.log(`   ✗ Error: ${err.message}`);
        reject(err);
      })
      .run();
  });
}

/**
 * Test 3: FFmpeg aggressive (400x400, -q:v 10)
 */
async function benchmarkFFmpegAggressive(inputFile) {
  return new Promise((resolve, reject) => {
    const startTime = Date.now();
    const outputFile = `./benchmark-output-aggressive-${Date.now()}.jpg`;
    const ffmpegInput = inputFile.replace(/\\/g, '/');
    const ffmpegOutput = outputFile.replace(/\\/g, '/');

    console.log('🟡 [Test 3] FFmpeg Aggressive (400x400, -q:v 10)');
    
    ffmpeg(ffmpegInput)
      .output(ffmpegOutput)
      .outputOptions([
        '-vf', 'scale=400:400:force_original_aspect_ratio=decrease',
        '-q:v', '10'
      ])
      .on('end', () => {
        const duration = Date.now() - startTime;
        console.log(`   ✓ Done in ${duration}ms`);
        resolve(duration);
      })
      .on('error', (err) => {
        console.log(`   ✗ Error: ${err.message}`);
        reject(err);
      })
      .run();
  });
}

/**
 * Test 4: FFmpeg ultra (300x300, -q:v 10, -t 1)
 */
async function benchmarkFFmpegUltra(inputFile) {
  return new Promise((resolve, reject) => {
    const startTime = Date.now();
    const outputFile = `./benchmark-output-ultra-${Date.now()}.jpg`;
    const ffmpegInput = inputFile.replace(/\\/g, '/');
    const ffmpegOutput = outputFile.replace(/\\/g, '/');

    console.log('🔴 [Test 4] FFmpeg Ultra (300x300, -q:v 10, seek 1s)');
    
    ffmpeg(ffmpegInput)
      .output(ffmpegOutput)
      .outputOptions([
        '-ss', '1',           // Skip to 1 second (faster decode)
        '-vf', 'scale=300:300:force_original_aspect_ratio=decrease',
        '-q:v', '10'
      ])
      .on('end', () => {
        const duration = Date.now() - startTime;
        console.log(`   ✓ Done in ${duration}ms`);
        resolve(duration);
      })
      .on('error', (err) => {
        console.log(`   ✗ Error: ${err.message}`);
        reject(err);
      })
      .run();
  });
}

/**
 * Main benchmark test
 */
async function runBenchmark() {
  console.log('\n=== RAW IMAGE PROCESSING BENCHMARK ===\n');

  // Find a test RAW file
  try {
    const files = await fs.readdir(UPLOAD_DIR);
    const rawFile = files.find(f => ['.arw', '.nef', '.cr2', '.cr3', '.dng'].includes(path.extname(f).toLowerCase()));
    
    if (!rawFile) {
      console.log('❌ ไม่พบ RAW file ใน ' + UPLOAD_DIR);
      console.log('ให้อัพโหลด NEF/ARW/CR2/CR3/DNG ก่อน');
      return;
    }

    const inputPath = path.join(UPLOAD_DIR, rawFile);
    console.log(`📷 Test file: ${rawFile}`);
    console.log(`   Path: ${inputPath}\n`);

    const results = {};

    // Run tests sequentially
    console.log('⏱️  Running tests...\n');

    try {
      results.current = await benchmarkFFmpegCurrent(inputPath);
    } catch (e) {
      results.current = 'ERROR';
    }
    console.log();

    try {
      results.optimized = await benchmarkFFmpegOptimized(inputPath);
    } catch (e) {
      results.optimized = 'ERROR';
    }
    console.log();

    try {
      results.aggressive = await benchmarkFFmpegAggressive(inputPath);
    } catch (e) {
      results.aggressive = 'ERROR';
    }
    console.log();

    try {
      results.ultra = await benchmarkFFmpegUltra(inputPath);
    } catch (e) {
      results.ultra = 'ERROR';
    }
    console.log();

    // Show results
    console.log('=== RESULTS ===\n');
    console.log(`Test 1 (Current):      ${results.current}ms`);
    console.log(`Test 2 (Optimized):    ${results.optimized}ms ${results.optimized !== 'ERROR' ? `(${((1 - results.optimized/results.current) * 100).toFixed(1)}% faster)` : ''}`);
    console.log(`Test 3 (Aggressive):   ${results.aggressive}ms ${results.aggressive !== 'ERROR' ? `(${((1 - results.aggressive/results.current) * 100).toFixed(1)}% faster)` : ''}`);
    console.log(`Test 4 (Ultra):        ${results.ultra}ms ${results.ultra !== 'ERROR' ? `(${((1 - results.ultra/results.current) * 100).toFixed(1)}% faster)` : ''}`);

    // Find best
    const validResults = Object.entries(results).filter(([, v]) => v !== 'ERROR');
    if (validResults.length > 0) {
      const best = validResults.reduce((a, b) => a[1] < b[1] ? a : b);
      console.log(`\n✅ Recommended: Test ${validResults.findIndex(r => r[0] === best[0]) + 1}`);
    }

    // Cleanup
    console.log('\n🧹 Cleaning up test files...');
    const benchmarkFiles = await fs.readdir('.');
    for (const file of benchmarkFiles) {
      if (file.startsWith('benchmark-output-')) {
        await fs.unlink(path.join('.', file));
      }
    }
    console.log('Done!');

  } catch (error) {
    console.error('❌ Benchmark error:', error);
  }

  process.exit(0);
}

// Run benchmark
runBenchmark();
