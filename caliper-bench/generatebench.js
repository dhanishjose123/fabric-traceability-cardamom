'use strict';

const fs = require('fs');
const path = require('path');

function generateBenchmarkFile({
    filePath = './benchmarks',
    fileName = 'benchmark.yaml',
    functions = ['makeoffer'],
    contractId = 'cardamom_11',
    channel = 'cardamom1003',
    txNumber = 5000,
    startRate = 50,
    tps,   // single TPS value
    userId = 'User1',
    limits,
}) {

    // Ensure directory exists
    if (!fs.existsSync(filePath)) {
        fs.mkdirSync(filePath, { recursive: true });
    }

    const fullPath = path.join(filePath, fileName);

    // ✅ Determine TPS safely
   

    // ✅ Debug (VERY IMPORTANT)
    console.log(`🔥 Using TPS: ${tps}`);

    // ✅ Generate YAML (single round)
    const yamlContent = `
test:
  name: Cardamom Chaincode Load Test
  description: Benchmarking under increasing load
  workers:
    type: local
    number: 5
  rounds:
    - label: ${functions[0]}_Load@${tps}
      description: Load @${tps} TPS for ${functions[0]}
      txNumber: ${txNumber}
      rateControl:
        type: fixed-rate
        opts:
          tps: ${tps}
      workload:
        module: ./workload_11/${functions[0]}.js
        arguments:
          contractId: ${contractId}
          channel: ${channel}
          userId: ${userId}
          limit: ${limits}
`;

    // Write file
    fs.writeFileSync(fullPath, yamlContent.trim(), 'utf8');

    console.log(`✅ Benchmark file generated at: ${fullPath}`);
}

module.exports = generateBenchmarkFile;