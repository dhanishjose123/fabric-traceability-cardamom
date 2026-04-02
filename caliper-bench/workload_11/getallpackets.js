'use strict';

const { WorkloadModuleBase } = require('@hyperledger/caliper-core');

class GetAllPacketsWorkload extends WorkloadModuleBase {

    async initializeWorkloadModule(workerIndex, totalWorkers, roundIndex, roundArguments, sutAdapter) {

        this.workerIndex = workerIndex;
        this.roundIndex = roundIndex;
        this.sutAdapter = sutAdapter;

        this.invokerIdentity = `_ConsumersMSP_User${workerIndex + 1}`;

        // Payload control parameter from benchmark config
        this.limit = roundArguments.limit ;

        console.log(
            `📦 Worker ${this.workerIndex}: Initialized with payloadLimit = ${this.limit}`
        );
    }

    async submitTransaction() {

        const tx = {
            contractId: 'cardamom_11',
            contractFunction: 'getAllPackets1',
            invokerIdentity: this.invokerIdentity,
            contractArguments: [this.limit],   // PAYLOAD ARGUMENT
            readOnly: true
        };

        try {

            const res = await this.sutAdapter.sendRequests(tx);

            const resultBuffer =
                res?.status?.result || res?.status?.payload;

            if (!resultBuffer) {
                console.log(
                    `⚠️ Worker ${this.workerIndex}: getAllPackets returned empty result`
                );
                return;
            }

            const payloadSizeBytes = Buffer.byteLength(resultBuffer);
            const payloadSizeKB = (payloadSizeBytes / 1024).toFixed(2);

            const packets = JSON.parse(resultBuffer.toString());

            console.log(
                `📦 Worker ${this.workerIndex}: ${packets.length} packets | Payload = ${payloadSizeKB} KB`
            );

        } catch (err) {

            console.error(
                `❌ Worker ${this.workerIndex}: Error calling getAllPackets`,
                err.message
            );
        }
    }
}

module.exports.createWorkloadModule = () => new GetAllPacketsWorkload();