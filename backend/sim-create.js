const axios = require("axios");

const BASE_URL = "http://localhost:5000";
const BANK_USER = { org: "bank", userId: "User1" }; // Bank initiates all deposits

const orgs = ["farmers", "aggregators", "retailers", "consumers"];
const users = ["Admin", "User1", "User2", "User3", "User4", "User5"];

async function initializeWalletsAndDeposit() {
  for (const org of orgs) {
    for (const userId of users) {
      const targetUser = { targetOrg: org, targetUserId: userId };

      try {
        // 🔹 Create Wallet (writes a fixed wallet metadata key, MVCC-safe if done once)
        const walletRes = await axios.post(`${BASE_URL}/create-wallet`, {
          ...BANK_USER,
          ...targetUser
        });
        console.log(`👜 Created wallet for ${org}.${userId}: ${walletRes.data.message}`);

        // 🕒 Random delay to stagger deposits and reduce MVCC collisions
        await new Promise(r => setTimeout(r, Math.floor(Math.random() * 100)));

        // 🔸 Deposit ₹10000000 using new chaincode logic (append-only log)
        const depositRes = await axios.post(`${BASE_URL}/deposit-money`, {
          ...BANK_USER,
          ...targetUser,
          amount: "10000000"
        });
        console.log(`💸 Deposited ₹1000 into ${org}.${userId}: ${depositRes.data.message}`);

        // 📊 (Optional) Fetch current balance after deposit
        const balanceRes = await axios.get(`${BASE_URL}/get-wallet-balance/${org}/${userId}`);
        console.log(`💰 Balance for ${org}.${userId}: ₹${balanceRes.data.balance}`);

      } catch (error) {
        console.error(`❌ Error for ${org}.${userId}:`, error.response?.data || error.message);
      }
    }
  }
}

initializeWalletsAndDeposit();
