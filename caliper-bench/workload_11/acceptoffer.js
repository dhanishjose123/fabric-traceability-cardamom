'use strict';

const { WorkloadModuleBase } = require('@hyperledger/caliper-core');
const fs = require('fs');
const path = require('path');

class AcceptOfferWorkload extends WorkloadModuleBase {

    constructor() {
        super();

        // 🔒 Track processed lots
        this.usedLotIds = new Set();

        // 📦 Cached lots
        this.allLots = [];
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

    this.farmerUserId = `User${workerIndex + 1}`;
    this.invokerIdentity = `User${workerIndex + 1}`;

    // 🔥 ALWAYS initialize
    this.availableLots = [];

    console.log(`✅ Worker ${this.workerIndex}: Initialized farmer ${this.farmerUserId}`);

    const queryTx = {
        contractId: 'cardamom_11',
        contractFunction: 'getLotsWithOffersByOwner',
        contractArguments: [`User${workerIndex + 1}`, '1000'],
        readOnly: true
    };

    try {
        const res = await this.sutAdapter.sendRequests(queryTx);

        if (!res?.status?.result) {
            console.log(`[INIT][Worker ${this.workerIndex}] ❌ No lots`);
            return;
        }

        const resultBuffer = res.status.result;
        const resultString = resultBuffer.toString();

        // ✅ Payload info
        console.log(`[Worker ${this.workerIndex}] 📏 Payload bytes: ${resultBuffer.length}`);

        let parsed;

        try {
            parsed = JSON.parse(resultString);
        } catch (err) {
            console.error(`[INIT][Worker ${this.workerIndex}] ❌ JSON parse failed`);
            return;
        }

        // 🔥 Normalize (important)
        if (Array.isArray(parsed)) {
            this.availableLots = parsed;

        } else if (parsed.data && Array.isArray(parsed.data)) {
            this.availableLots = parsed.data;

        } else if (typeof parsed === 'object' && parsed !== null) {
            this.availableLots = [parsed];

        } else {
            this.availableLots = [];
        }

        console.log(
            `[INIT][Worker ${this.workerIndex}] 📦 Loaded ${this.availableLots.length} lots`
        );

    } catch (err) {
        console.error(`[INIT][Worker ${this.workerIndex}] ❌ Error`, err.message);
        this.availableLots = [];
    }
}

    /* ============================================================
       🔹 MAIN TX LOOP
    ============================================================ */
    async submitTransaction() {

        /* ---------------------------------
           🟡 CASE 1: No eligible lots
        ---------------------------------- */
        if (this.availableLots.length === 0) {

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

        /* ---------------------------------
           🔹 Pick random lot
        ---------------------------------- */
       const lot = this.availableLots[this.lotIndex];
       this.lotIndex++;

        if (this.lotIndex >= this.availableLots.length) {
            this.lotIndex = 0;   // loop again
        }
        if (!lot || !lot.lotId || !lot.highestOffer) {
            return;
        }

        const lotId = lot.lotId;

        /* ---------------------------------
           🟡 CASE 2: Already processed
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
           🔹 Prepare TX
        ---------------------------------- */
        const args = [lotId, lot.highestOffer.retailerId];

        const acceptTx = {
            contractId: 'cardamom_11',
            contractFunction: 'acceptOffer',
            invokerIdentity: this.invokerIdentity,
            contractArguments: args,
            readOnly: false
        };

        /* ---------------------------------
           📏 Payload size
        ---------------------------------- */
        const payloadString = JSON.stringify(args);
        const payloadBytes = Buffer.byteLength(payloadString, 'utf8');
        const payloadKB = payloadBytes / 1024;

        if (this.txIndex < 50) {
            fs.appendFileSync(
                this.payloadFile,
                `acceptOffer,${payloadBytes},${payloadKB.toFixed(4)}\n`
            );
        }

        this.txIndex++;

        /* ---------------------------------
           🚀 Execute TX
        ---------------------------------- */
        this.txAttempted++;

        try {
            await this.sutAdapter.sendRequests(acceptTx);

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
        if (this.txAttempted % 10 === 0) {

            console.log(
                `📊 [Worker ${this.workerIndex}] ` +
                `Attempt=${this.txAttempted}, ` +
                `Success=${this.txSucceeded}, ` +
                `Dummy=${this.dummyTxCount}, ` +
                `MVCC=${this.txMVCCFailed}, ` +
                `Failed=${this.txFailed}`
            );
        }
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

module.exports.createWorkloadModule = () => new AcceptOfferWorkload();