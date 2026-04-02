'use strict';

const fs = require('fs');
const path = require('path');

// ===============================
// 🔹 ROOT PATH
// ===============================
const baseDir = __dirname;

// ===============================
// 🔹 OUTPUT DIRECTORY
// ===============================
const resultsDir = path.join(baseDir, 'results');

if (!fs.existsSync(resultsDir)) {
    fs.mkdirSync(resultsDir);
}

// ===============================
// 🔹 MASTER FILE (OVERWRITE EACH RUN)
// ===============================
const masterFile = path.join(resultsDir, 'throughput_results_all.csv');

fs.writeFileSync(
    masterFile,
    "folder,function,load,success,fail,sendRate,maxLatency,minLatency,avgLatency,throughput\n"
);

// ===============================
// 🔹 FIND ALL LOG FOLDERS
// ===============================
const allItems = fs.readdirSync(baseDir);

const logFolders = [...new Set(
    allItems.filter(item => {
        const fullPath = path.join(baseDir, item);
        return fs.existsSync(fullPath) &&
            fs.statSync(fullPath).isDirectory() &&
            item.startsWith('logs');
    })
)];

console.log("📂 Found folders:", logFolders);

// ===============================
// 🔹 GLOBAL DUPLICATE TRACKER
// ===============================
const seenRows = new Set();

// ===============================
// 🔹 PROCESS EACH FOLDER
// ===============================
for (const folder of logFolders) {

    const logDir = path.join(baseDir, folder);

    // Per-folder output
    const folderFile = path.join(resultsDir, `throughput_${folder}.csv`);

    // Overwrite folder file
    fs.writeFileSync(
        folderFile,
        "function,load,success,fail,sendRate,maxLatency,minLatency,avgLatency,throughput\n"
    );

    const files = fs.readdirSync(logDir);

    for (const file of files) {

        if (!file.endsWith('.log')) continue;
        if (file.includes('cpu') || file.includes('docker')) continue;

        const filePath = path.join(logDir, file);

        const lines = fs.readFileSync(filePath, 'utf8').split('\n');

        for (const line of lines) {

            // ✅ Filter only FINAL Caliper metric lines
            if (
                line.includes("|") &&
                line.includes("_Load@") &&
                !line.includes("Submitted:")
            ) {

                const parts = line.split("|").map(x => x.trim());

                if (parts.length >= 9) {

                    const name = parts[1];
                    const success = parts[2];
                    const fail = parts[3];
                    const sendRate = parts[4];
                    const maxLatency = parts[5];
                    const minLatency = parts[6];
                    const avgLatency = parts[7];
                    const throughput = parts[8];

                    // 🔹 Extract load
                    const loadMatch = name.match(/Load@(\d+)/);
                    const load = loadMatch ? loadMatch[1] : "";

                    // 🔹 Extract function
                    const func = name.split("_Load")[0];

                    // 🔹 UNIQUE KEY (critical)
                    const uniqueKey = `${folder}-${file}-${func}-${load}`;

                    if (!seenRows.has(uniqueKey)) {

                        seenRows.add(uniqueKey);

                        const row = `${func},${load},${success},${fail},${sendRate},${maxLatency},${minLatency},${avgLatency},${throughput}\n`;

                        // ✅ Write folder file
                        fs.appendFileSync(folderFile, row);

                        // ✅ Write master file
                        fs.appendFileSync(masterFile, `${folder},${row}`);
                    }
                }
            }
        }
    }

    console.log(`✅ Processed folder: ${folder}`);
}

// ===============================
console.log("\n🎯 Throughput extraction completed");
console.log("📄 Master file:", masterFile);