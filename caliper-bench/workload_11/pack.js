'use strict';

const { WorkloadModuleBase } = require('@hyperledger/caliper-core');
const fs = require('fs');
const path = require('path');

class PackLotWorkload extends WorkloadModuleBase {

    constructor() {
        super();

        // 🔒 Prevent duplicate packing
        this.usedLotIds = new Set();

        // 📦 Cached SOLD lots
        this.soldLots = [];
        this.lotIndex = 0;

        // 📊 Counters
        this.txAttempted = 0;
        this.txSucceeded = 0;
        this.txFailed = 0;
        this.txMVCCFailed = 0;

        this.dummyTxCount = 0;   // ✅ NEW
        this.realTxCount = 0;    // ✅ NEW

        // 📏 Payload tracking
        this.txIndex = 0;
        this.payloadFile = './payload_sizes.csv';

        if (!fs.existsSync(this.payloadFile)) {
            fs.writeFileSync(this.payloadFile, 'function,payload_bytes,payload_kb\n');
        }
    }

    /* ============================================================
       🔹 INIT
    ============================================================ */
    async initializeWorkloadModule(workerIndex, totalWorkers, roundIndex, roundArguments, sutAdapter) {

        this.workerIndex = workerIndex;
        this.sutAdapter = sutAdapter;

        this.retailerUserId = `User${workerIndex + 1}`;
        this.invokerIdentity = `_RetailersMSP_User${workerIndex + 1}`;

        console.log(`✅ Worker ${this.workerIndex}: Retailer ${this.retailerUserId}`);

        const lotQuery = {
            contractId: 'cardamom_11',
            contractFunction: 'getProduceByStatusAndOwner',
            contractArguments: [`SOLD`,`User${workerIndex+1}`, '1000'],
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

            console.log(`📥 Worker ${this.workerIndex} result length: ${resultString.length}`);

            const parsed = JSON.parse(resultString);

            this.allLots = parsed.data || [];

            console.log(`📦 Worker ${this.workerIndex+1}: Cached ${this.allLots.length} lots`);

        } catch (err) {
            console.error(`❌ Worker ${this.workerIndex}: Fetch failed`, err);
        }

       
    }

    /* ============================================================
       🔹 MAIN TX LOOP
    ============================================================ */
    async submitTransaction() {


        /* ---------------------------------
           🟡 CASE 1: No SOLD lots
        ---------------------------------- */
        if (this.allLots.length === 0) {

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
        }
        /* ---------------------------------
           🔹 Pick random lot
        ---------------------------------- */
        const lot = this.allLots[this.lotIndex];
        this.lotIndex++;

            if (this.lotIndex >= this.allLots.length) {
                this.lotIndex = 0;   // loop again
            }

        if (!lot || !lot.lotId) {
            return;
        }

        const lotId = lot.lotId;

        /* ---------------------------------
           🟡 CASE 2: Already packed
        ---------------------------------- */
        if (this.usedLotIds.has(lotId)) {

            this.dummyTxCount++;
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

                this.usedLotIds.add(lotId);

        /* ---------------------------------
           🔹 Generate inputs
        ---------------------------------- */
        const price1kg  = (Math.random() * 200 + 800).toFixed(2);
        const price500g = (Math.random() * 150 + 500).toFixed(2);
        const price250g = (Math.random() * 100 + 300).toFixed(2);
        const price100g = (Math.random() * 50  + 100).toFixed(2);

        const packingVideoHash = `ipfs-pack-${Date.now()}-${this.workerIndex}`;

        const args = [
            lotId,
            price1kg,
            price500g,
            price250g,
            price100g,
            packingVideoHash
        ];

        const packTx = {
            contractId: 'cardamom_11',
            contractFunction: 'packLotIntoPackets',
            invokerIdentity: this.invokerIdentity,
            contractArguments: args,
            readOnly: false
        };

        /* ---------------------------------
           📏 Payload measurement
        ---------------------------------- */
        const payloadString = JSON.stringify(args);
        const payloadBytes = Buffer.byteLength(payloadString, 'utf8');
        const payloadKB = payloadBytes / 1024;

        if (this.txIndex < 50) {
            fs.appendFileSync(
                this.payloadFile,
                `packLotIntoPackets,${payloadBytes},${payloadKB.toFixed(4)}\n`
            );
        }

        this.txIndex++;

        /* ---------------------------------
           🚀 Execute TX
        ---------------------------------- */
        this.txAttempted++;

        try {

            await this.sutAdapter.sendRequests(packTx);

            this.txSucceeded++;
            this.realTxCount++;   // ✅ REAL TX

        } catch (err) {

            this.txFailed++;

            const msg = err?.message || '';

            if (
                msg.includes('MVCC') ||
                msg.includes('PHANTOM') ||
                msg.includes('CONFLICT')
            ) {
                this.txMVCCFailed++;
            }
        }

        /* ---------------------------------
           📊 Periodic stats
        ---------------------------------- */
       
    }

    /* ============================================================
       🔹 FINAL SUMMARY
    ============================================================ */
    async cleanupWorkloadModule() {

        const total = this.realTxCount + this.dummyTxCount;
        const dummyRatio = total > 0 ? (this.dummyTxCount / total) * 100 : 0;

        console.log(`\n📊 ===== Worker ${this.workerIndex} Summary =====`);
        console.log(`   ✅ Real TX        : ${this.realTxCount}`);
        console.log(`   🟡 Dummy TX       : ${this.dummyTxCount}`);
        console.log(`   ❌ Failed TX      : ${this.txFailed}`);
        console.log(`   ⚠️ MVCC Conflicts : ${this.txMVCCFailed}`);
        console.log(`   📈 Total TX       : ${total}`);
        console.log(`   ⚖️ Dummy Ratio    : ${dummyRatio.toFixed(2)}%`);
    }
}

module.exports.createWorkloadModule = () => new PackLotWorkload();