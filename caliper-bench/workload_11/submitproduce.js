'use strict';

const { WorkloadModuleBase } = require('@hyperledger/caliper-core');
const fs = require('fs');

class SubmitProduceWorkload extends WorkloadModuleBase {

    constructor() {
        super();

        this.txCounter = 0;   // 🔹 total transactions per worker

        // 📦 Payload logging file
        this.payloadFile = './payload_sizes.csv';

        if (!fs.existsSync(this.payloadFile)) {
            fs.writeFileSync(this.payloadFile, 'function,payload_bytes,payload_kb\n');
        }
    }

    async initializeWorkloadModule(workerIndex, totalWorkers, roundIndex, roundArguments, sutAdapter) {
        this.workerIndex = workerIndex;
        this.sutAdapter = sutAdapter;

        this.userId = `User${workerIndex + 1}`;
        this.invokerIdentity = `User${workerIndex + 1}`;

        console.log(`🔧 Worker ${workerIndex} initialized as ${this.userId}`);
    }

    async submitTransaction() {

        /* ---------------------------------
           1️⃣ Unique Lot ID
        ---------------------------------- */
        const lotId = `LOT-${this.workerIndex}-${this.txCounter}-${Date.now()}`;

        const users = ['User1', 'User2', 'User3', 'User4', 'User5'];
        const randomUserId = users[Math.floor(Math.random() * users.length)];

        /* ---------------------------------
           2️⃣ Prepare request
        ---------------------------------- */
        const args = [
            lotId,
            this.userId,
            '10',
            '2025-07-21',
            '1',
            randomUserId
        ];

        const request = {
            contractId: 'cardamom_11',
            contractFunction: 'submitProduce',
            invokerIdentity: this.invokerIdentity,
            contractArguments: args,
            readOnly: false
        };

        /* ---------------------------------
           📏 PAYLOAD SIZE
        ---------------------------------- */
        const payloadString = JSON.stringify(args);
        const payloadBytes = Buffer.byteLength(payloadString, 'utf8');
        const payloadKB = payloadBytes / 1024;

        fs.appendFileSync(
            this.payloadFile,
            `submitProduce,${payloadBytes},${payloadKB.toFixed(4)}\n`
        );

        /* ---------------------------------
           3️⃣ Send transaction
        ---------------------------------- */
        try {
            await this.sutAdapter.sendRequests(request);
        } catch (error) {
            // ❌ Ignore errors completely (as you requested)
        }

        // 🔥 Increment total counter ALWAYS
        this.txCounter++;
    }

    /* ---------------------------------
       🔚 FINAL SUMMARY (PER WORKER)
    ---------------------------------- */
    async cleanupWorkloadModule() {

        console.log(`
==============================
📊 Worker ${this.workerIndex} Summary
------------------------------
👤 User: ${this.userId}
📦 Total Transactions: ${this.txCounter}
==============================
`);
    }
}

function createWorkloadModule() {
    return new SubmitProduceWorkload();
}

module.exports.createWorkloadModule = createWorkloadModule;