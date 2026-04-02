'use strict';

const { WorkloadModuleBase } = require('@hyperledger/caliper-core');
const fs = require('fs');
const path = require('path');

/* ============================================================
   🔹 RANDOM GRADING GENERATOR
============================================================ */
function generateRandomGrading(weightKg) {
    const sizeGrades = {};
    const sizeCategories = ["8+mm", "7-8mm", "6-7mm", "<6mm"];
    let remainingPercent = 100;

    for (let i = 0; i < sizeCategories.length; i++) {
        const total = i === sizeCategories.length - 1
            ? remainingPercent
            : Math.floor(Math.random() * (remainingPercent / 2) + 5);

        remainingPercent -= total;

        const clean = Math.floor(total * 0.5 + Math.random() * 10);
        const sick = Math.floor(total * 0.2 + Math.random() * 5);
        const split = Math.max(0, total - clean - sick);

        sizeGrades[sizeCategories[i]] = {
            clean,
            sick,
            split,
            total: clean + sick + split
        };
    }

    const greenPercent = Math.floor(Math.random() * 40 + 30);
    const averagePercent = Math.floor(Math.random() * (100 - greenPercent));
    const fruitPercent = Math.floor(Math.random() * (100 - greenPercent - averagePercent));
    const belowAveragePercent = 100 - greenPercent - averagePercent - fruitPercent;

    return {
        sizeGrades,
        greenPercent,
        averagePercent,
        fruitPercent,
        belowAveragePercent,
        literWeight: Math.floor(Math.random() * 40 + 320),
        moisture: parseFloat((Math.random() * 2 + 6).toFixed(2)),
        numberOfBags: Math.floor(Math.random() * 6 + 10),
        netWeight: weightKg || Math.floor(Math.random() * 101 + 500)
    };
}

/* ============================================================
   🔹 WORKLOAD CLASS
============================================================ */
class TestCardamomWorkload extends WorkloadModuleBase {

    constructor() {
        super();

        // 📊 Counters
        this.dummyTxCount = 0;
        this.realTxCount = 0;

        // 🧾 Logs
        this.failedTxLog = [];
        this.dummyTxLog = [];

        // 📦 State
        this.packedLotIds = [];
        this.cachedLots = [];
        this.txIndex = 0;

        // 📁 Payload file
        this.payloadFile = './payload_sizes.csv';

        if (!fs.existsSync(this.payloadFile)) {
            fs.writeFileSync(this.payloadFile, 'function,payload_bytes,payload_kb\n');
        }
    }

    /* ============================================================
       🔹 INITIALIZATION
    ============================================================ */
    async initializeWorkloadModule(workerIndex, totalWorkers, roundIndex, roundArguments, sutAdapter) {

        this.workerIndex = workerIndex;
        this.totalWorkers = totalWorkers;
        this.roundIndex = roundIndex;
        this.roundArguments = roundArguments;
        this.sutAdapter = sutAdapter;

        this.aggregatorId = `_AggregatorsMSP_User${workerIndex}`;

        console.log(`🔧 Worker ${workerIndex+1} initialized`);

        // -------------------------------
        // 📦 Fetch lots
        // -------------------------------
        console.log(`🔧 Worker Index: ${workerIndex+1}`);
        const lotQuery = {
            contractId: 'cardamom_11',
            contractFunction: 'getSubmittedProduceByAggregator',
            contractArguments: [`User${workerIndex+1}`, '1000'],
            readOnly: true
        };

        try {
            const response = await this.sutAdapter.sendRequests(lotQuery);

            let buffer;

            // 🔥 Case 1: Direct TxStatus (your current case)
            if (response?.status?.result) {
                buffer = response.status.result;
            }
            // 🔥 Case 2: Array format
            else if (Array.isArray(response) && response[0]?.status?.result) {
                buffer = response[0].status.result;
            }
            // 🔥 Case 3: Direct buffer
            else if (Array.isArray(response) && response[0]) {
                buffer = response[0];
            }

            if (!buffer) {
                console.error(`⚠️ Worker ${this.workerIndex}: No buffer result`);
                console.log("🔍 Full response:", response);
                return;
            }

            const resultString = buffer.toString();

            

            const parsed = JSON.parse(resultString);

            this.allLots = parsed.data || [];

            console.log(`📦 Worker ${this.workerIndex}: Cached ${this.allLots.length} lots`);

        } catch (err) {
            console.error(`❌ Worker ${this.workerIndex}: Fetch failed`, err);
        }
    }

    /* ============================================================
       🔹 MAIN TRANSACTION LOOP
    ============================================================ */
    async submitTransaction() {

        const availableLots = this.allLots.filter(
            lot => !this.packedLotIds.includes(lot.lotId)
        );

        // -------------------------------
        // 🟡 DUMMY TRANSACTION
        // -------------------------------
        if (availableLots.length === 0) {

            this.dummyTxCount++;

            this.dummyTxLog.push({
                time: Date.now(),
                worker: this.workerIndex
            });

            const request = {
                        contractId: 'cardamom_11',
                        contractFunction: 'dummyPackLoad',
                        invokerIdentity: this.invokerIdentity,
                        contractArguments: [
                            `DUMMY-${this.workerIndex}-${Date.now()}`,
                               // number of writes
                        ],
                        readOnly: false
                    };

            await this.sutAdapter.sendRequests(request);
            return;
        }

        // -------------------------------
        // ✅ REAL TRANSACTION
        // -------------------------------
        const lot = availableLots[Math.floor(Math.random() * availableLots.length)];

        const grading = generateRandomGrading(lot.weightKg);

        this.packedLotIds.push(lot.lotId);

        const args = [
            lot.lotId,
            'pass',
            'QmSampleVideoHash12345',
            JSON.stringify(grading)
        ];

        const testTx = {
            contractId: 'cardamom_11',
            contractFunction: 'testCardamom',
            invokerIdentity: this.aggregatorId,
            contractArguments: args,
            readOnly: false
        };

        // -------------------------------
        // 📏 Payload measurement
        // -------------------------------
        const payloadString = JSON.stringify(args);
        const payloadBytes = Buffer.byteLength(payloadString, 'utf8');
        const payloadKB = payloadBytes / 1024;

        if (this.txIndex < 50) {
            fs.appendFileSync(
                this.payloadFile,
                `testCardamom,${payloadBytes},${payloadKB.toFixed(4)}\n`
            );
        }

        this.txIndex++;

        // -------------------------------
        // 🚀 Execute TX
        // -------------------------------
        try {
            await this.sutAdapter.sendRequests(testTx);

            this.realTxCount++;

        } catch (err) {

            const failure = {
                timestamp: new Date().toISOString(),
                worker: this.workerIndex,
                function: 'testCardamom',
                args,
                error: err.message
            };

            this.failedTxLog.push(failure);

            console.error(`❌ Worker ${this.workerIndex}: TX failed`, err);
        }
    }

    /* ============================================================
       🔹 CLEANUP (FINAL REPORT)
    ============================================================ */
    async cleanupWorkloadModule() {

        const dummy = this.dummyTxCount;
        const real = this.realTxCount;
        const failed = this.failedTxLog.length;
        const total = real + dummy;

        const dummyRatio = total > 0 ? (dummy / total) * 100 : 0;

        console.log(`\n📊 ===== Worker ${this.workerIndex} Summary =====`);
        console.log(`   ✅ Real Transactions   : ${real}`);
        console.log(`   🟡 Dummy Transactions  : ${dummy}`);
        console.log(`   ❌ Failed Transactions : ${failed}`);
        console.log(`   📈 Total Submitted     : ${total}`);
        console.log(`   ⚖️ Dummy Ratio        : ${dummyRatio.toFixed(2)}%`);

        // -------------------------------
        // Save failed TX
        // -------------------------------
        if (failed > 0) {
            const filePath = path.join(__dirname, `failed_tx_worker${this.workerIndex}.json`);
            fs.writeFileSync(filePath, JSON.stringify(this.failedTxLog, null, 2));
            console.log(`📁 Failed TX saved`);
        }

        // -------------------------------
        // Save dummy TX (optional)
        // -------------------------------
        if (this.dummyTxLog.length > 0) {
            const filePath = path.join(__dirname, `dummy_tx_worker${this.workerIndex}.json`);
            fs.writeFileSync(filePath, JSON.stringify(this.dummyTxLog, null, 2));
            console.log(`📁 Dummy TX saved`);
        }
    }
}

/* ============================================================
   🔹 EXPORT
============================================================ */
function createWorkloadModule() {
    return new TestCardamomWorkload();
}

module.exports.createWorkloadModule = createWorkloadModule;