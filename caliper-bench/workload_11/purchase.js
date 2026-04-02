'use strict';

const { WorkloadModuleBase } = require('@hyperledger/caliper-core');
const fs = require('fs');

class PurchasePacketWorkload extends WorkloadModuleBase {

    constructor() {
        super();

        // 📦 Cached AVAILABLE packets
        this.availablePackets = [];

        // 🔒 Prevent reuse
        this.usedPacketIds = new Set();

        // 📊 Counters
        this.txAttempted = 0;
        this.txSucceeded = 0;
        this.txMVCCFailed = 0;
        this.txOtherFailed = 0;

        this._lastRoundIndex = -1;

        // 📏 Payload tracking
        this.txIndex = 0;
        this.payloadFile = './payload_sizes.csv';

        if (!fs.existsSync(this.payloadFile)) {
            fs.writeFileSync(this.payloadFile, 'function,payload_bytes,payload_kb\n');
        }
    }

    async initializeWorkloadModule(workerIndex, totalWorkers, roundIndex, roundArguments, sutAdapter) {

        this.workerIndex = workerIndex;
        this.totalWorkers = totalWorkers;
        this.roundIndex = roundIndex;
        this.roundArguments = roundArguments;
        this.sutAdapter = sutAdapter;

        this.userId = `User${workerIndex + 1}`;
        this.invokerIdentity = `_ConsumersMSP_${this.userId}`;

        console.log(
            `✅ Worker ${this.workerIndex}: Initialized consumer ${this.userId}`
        );

        /* ---------------------------------
           🔹 INITIAL QUERY
        ---------------------------------- */
        const queryTx = {
            contractId: 'cardamom_11',
            contractFunction: 'getAllPackets',
            contractArguments: ["AVAILABLE", "5000"],
            readOnly: true
        };

        try {

            const res = await this.sutAdapter.sendRequests(queryTx);

            if (!res?.status?.result) {
                console.log(
                    `[INIT][Worker ${this.workerIndex}] ❌ No packets returned`
                );
                return;
            }

            const allPackets = JSON.parse(res.status.result.toString());

            this.availablePackets = allPackets.filter(
                p => p.status === 'AVAILABLE'
            );

            console.log(
                `[INIT][Worker ${this.workerIndex}] 📦 Cached ${this.availablePackets.length} AVAILABLE packets`
            );

        } catch (err) {
            console.error(
                `[INIT][Worker ${this.workerIndex}] ❌ Failed to load packets`,
                err.message || err
            );
        }
    }

    async submitTransaction() {

        /* ---------------------------------
           📊 Round logging
        ---------------------------------- */
        if (this.roundIndex !== this._lastRoundIndex) {
            this._lastRoundIndex = this.roundIndex;

            console.log(
                `📊 [PurchasePacket][Worker ${this.workerIndex}] ` +
                `Attempts=${this.txAttempted}, Success=${this.txSucceeded}, ` +
                `MVCC=${this.txMVCCFailed}, OtherFail=${this.txOtherFailed}`
            );
        }

        /* ---------------------------------
           1️⃣ No packets → skip
        ---------------------------------- */
        if (this.availablePackets.length === 0) {
            return;
        }

        /* ---------------------------------
           2️⃣ Pick unused packet
        ---------------------------------- */
        let packet;
        let safety = 0;

        while (safety < this.availablePackets.length) {

            const candidate =
                this.availablePackets[
                    Math.floor(Math.random() * this.availablePackets.length)
                ];

            if (!this.usedPacketIds.has(candidate.packetId)) {
                packet = candidate;
                break;
            }

            safety++;
        }

        if (!packet || !packet.packetId) {
            return;
        }

        const packetId = packet.packetId;

        this.usedPacketIds.add(packetId);

        /* ---------------------------------
           3️⃣ Prepare transaction
        ---------------------------------- */
        const args = [
            packetId,
            this.userId
        ];

        const purchaseTx = {
            contractId: 'cardamom_11',
            contractFunction: 'purchasePacket',
            invokerIdentity: this.invokerIdentity,
            contractArguments: args,
            readOnly: false
        };

        /* ---------------------------------
           📏 PAYLOAD MEASUREMENT
        ---------------------------------- */
        const payloadString = JSON.stringify(args);
        const payloadBytes = Buffer.byteLength(payloadString, 'utf8');
        const payloadKB = payloadBytes / 1024;

        if (this.txIndex < 50) {
            fs.appendFileSync(
                this.payloadFile,
                `purchasePacket,${payloadBytes},${payloadKB.toFixed(4)}\n`
            );
        }

        this.txIndex++;

        /* ---------------------------------
           🚀 Execute transaction
        ---------------------------------- */
        this.txAttempted++;

        try {

            await this.sutAdapter.sendRequests(purchaseTx);

            this.txSucceeded++;

        } catch (err) {

            const msg = err?.message || '';

            if (
                msg.includes('MVCC') ||
                msg.includes('PHANTOM') ||
                msg.includes('CONFLICT')
            ) {
                this.txMVCCFailed++;
            } else {
                this.txOtherFailed++;
            }
        }

        /* ---------------------------------
           📊 Periodic stats
        ---------------------------------- */
        if (this.txAttempted % 10 === 0) {

            console.log(
                `📊 [PurchasePacket][Worker ${this.workerIndex}] ` +
                `Attempts=${this.txAttempted}, Success=${this.txSucceeded}, ` +
                `MVCC=${this.txMVCCFailed}, OtherFail=${this.txOtherFailed}`
            );
        }
    }
}

module.exports.createWorkloadModule = () => new PurchasePacketWorkload();