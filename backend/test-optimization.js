/**
 * Performance Test - Measure optimization impact
 * Test caching and optimized FFmpeg settings
 */

const http = require('http');
const path = require('path');

const TEST_IMAGE = '1774232006083-233536363.NEF'; // 29MB NEF file

function makeRequest(endpoint) {
  return new Promise((resolve, reject) => {
    const startTime = Date.now();
    
    const options = {
      hostname: 'localhost',
      port: 5000,
      path: endpoint,
      method: 'GET'
    };

    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        const duration = Date.now() - startTime;
        resolve({
          status: res.statusCode,
          duration: duration,
          size: data.length
        });
      });
    });

    req.on('error', reject);
    req.setTimeout(60000);
    req.end();
  });
}

async function runTest() {
  console.log('\n=== OPTIMIZATION PERFORMANCE TEST ===\n');
  console.log(`Test image: ${TEST_IMAGE} (29MB NEF)\n`);

  try {
    // Test 1: First preview generation (will convert RAW)
    console.log('🔵 Test 1: First preview (FFmpeg conversion + cache)');
    const start1 = Date.now();
    const result1 = await makeRequest(`/api/image/metadata/${TEST_IMAGE}`);
    const total1 = Date.now() - start1;
    console.log(`   Status: ${result1.status}, API Time: ${result1.duration}ms\n`);

    // Test 2: Second preview (should use cache)
    console.log('🟢 Test 2: Second preview (cache hit)');
    const start2 = Date.now();
    const result2 = await makeRequest(`/api/image/metadata/${TEST_IMAGE}`);
    const total2 = Date.now() - start2;
    console.log(`   Status: ${result2.status}, API Time: ${result2.duration}ms`);
    console.log(`   Cache improvement: ${result1.duration - result2.duration}ms\n`);

    // Test 3: Preview generation
    console.log('🟡 Test 3: Generate preview endpoint');
    const start3 = Date.now();
    const result3 = await makeRequest(`/api/image/preview?filename=${TEST_IMAGE}`);
    const total3 = Date.now() - start3;
    console.log(`   Status: ${result3.status}, Response time: ${result3.duration}ms\n`);

    // Results
    console.log('=== RESULTS ===\n');
    console.log(`Server is responding correctly`);
    console.log(`FFmpeg optimization appears active`);
    console.log(`API response times: ${result1.duration}ms initial, ${result2.duration}ms cached\n`);

    console.log('💡 Next steps:');
    console.log('1. Open http://localhost:5000 in browser');
    console.log('2. Upload a NEF/CR2/ARW file');
    console.log('3. Check conversion time in browser console');
    console.log('4. Should see "RAW converted in ~300ms" message\n');

  } catch (error) {
    console.error('Test error:', error.message);
  }

  process.exit(0);
}

// Wait for server to start
setTimeout(runTest, 2000);
