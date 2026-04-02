'use strict';

const { WorkloadModuleBase } = require('@hyperledger/caliper-core');

class GetAllProduceWorkload extends WorkloadModuleBase {

    async initializeWorkloadModule(workerIndex, totalWorkers, roundIndex, roundArguments, sutAdapter) {
        this.workerIndex = workerIndex;
        this.sutAdapter = sutAdapter;

        // 🔥 safe init
        this.roundArguments = roundArguments || {};

        // Read-only identity
        this.invokerIdentity = `_AggregatorsMSP_User${workerIndex + 1}`;

        // 🔥 safe + string
        this.limit = (this.roundArguments.limit || 200).toString();

        console.log(
            `✅ Worker ${this.workerIndex}: Initialized getAllProduce workload (limit=${this.limit})`
        );
    }

    async submitTransaction() {

        const tx = {
            contractId: 'cardamom_11',
            contractFunction: 'getAllProduce',
            contractArguments: [this.limit],
            invokerIdentity: this.invokerIdentity,
            readOnly: true
        };

        try {

            const res = await this.sutAdapter.sendRequests(tx);

            const resultBuffer =
                res?.status?.result || res?.status?.payload;

            if (!resultBuffer) return;

            const payloadSizeBytes = Buffer.byteLength(resultBuffer);
            const payloadSizeKB = (payloadSizeBytes / 1024).toFixed(2);

            const lots = JSON.parse(resultBuffer.toString());

            console.log(
                `📦 Worker ${this.workerIndex}: ${lots.length} lots | Payload = ${payloadSizeKB} KB`
            );

        } catch (err) {

            console.error(
                `❌ Worker ${this.workerIndex}: Error calling getAllProduce`,
                err.message
            );
        }
    }
}

function createWorkloadModule() {
    return new GetAllProduceWorkload();
}

module.exports.createWorkloadModule = createWorkloadModule;