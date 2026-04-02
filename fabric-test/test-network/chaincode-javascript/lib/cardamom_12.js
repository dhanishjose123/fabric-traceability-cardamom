'use strict';

const { Contract } = require('fabric-contract-api');

class SupplyChainContract extends Contract {

   _logInvocation(fnName, args, ctx) {
    console.log(`\n📥 Invoked function: ${fnName}`);
    console.log(`🔗 Transaction ID: ${ctx.stub.getTxID()}`);
    console.log(`📡 Channel ID: ${ctx.stub.getChannelID()}`);
    if (args && args.length) {
      for (let i = 0; i < args.length; i++) {
        console.log(`   └─ arg[${i}]:`, args[i]);
      }
    }
  }
  async getMSPID(ctx) {
    this._logInvocation("getMSPID", arguments, ctx);
    console.log("🚀 Function `getMSPID` invoked");
    return ctx.clientIdentity.getMSPID();
  }

  _requireOrg(ctx, requiredMSP) {
    
    console.log("🚀 Function `_requireOrg` invoked");
    this._logInvocation("requireOrg", arguments, ctx);
    const callerMSP = ctx.clientIdentity.getMSPID();
    if (callerMSP !== requiredMSP) {
      throw new Error(`Access denied: Only members of ${requiredMSP} can perform this action. Caller MSP: ${callerMSP}`);
    }
  }

  // ====================== WALLET ======================
async createWallet(ctx, org, userId) {
    this._logInvocation("createWallet", arguments, ctx);
    console.log("🚀 Function `createWallet` invoked");

    this._requireOrg(ctx, 'BankMSP');
    const walletKey = `${org}-${userId}-wallet`;

    const existing = await ctx.stub.getState(walletKey);
    if (existing && existing.length > 0) throw new Error('Wallet already exists');

    const wallet = {
        owner: userId,
        org,
        createdAt: new Date().toISOString(),
        docType: 'wallet'
    };

    await ctx.stub.putState(walletKey, Buffer.from(JSON.stringify(wallet)));
    return `✅ Wallet created for ${walletKey}`;
}


async depositMoney(ctx, org, userId, amount) {
    this._logInvocation("depositMoney", arguments, ctx);
    console.log("🚀 Function `depositMoney` invoked");

    this._requireOrg(ctx, 'BankMSP');

    const txId = ctx.stub.getTxID(); // Unique transaction ID
    const txTimestamp = ctx.stub.getTxTimestamp();
    const timestamp = new Date(txTimestamp.seconds.low * 1000).toISOString();

    const amountValue = parseFloat(amount);

    if (isNaN(amountValue) || amountValue <= 0) {
        throw new Error(`Invalid deposit amount: ${amount}`);
    }

    // 🔐 Create a unique composite key for the transaction log
    const txKey = ctx.stub.createCompositeKey('walletTx', [org, userId, txId]);

    const logEntry = {
        type: 'deposit',
        delta: amountValue,
        org,
        userId,
        timestamp
    };

    // 📝 Log the write action for easier debugging
    console.log(`📝 Writing deposit entry to key: ${txKey}`);

    // ✅ MVCC-safe write
    await ctx.stub.putState(txKey, Buffer.from(JSON.stringify(logEntry)));

    return `✅ Deposited ₹${amount} to ${org}-${userId} (tx: ${txId})`;
}


async getWalletBalance(ctx, org, userId) {
    const iterator = await ctx.stub.getStateByPartialCompositeKey('walletTx', [org, userId]);

    let balance = 0;
    while (true) {
        const res = await iterator.next();
        if (res.value && res.value.value.toString()) {
            const tx = JSON.parse(res.value.value.toString());
            balance += tx.delta;
        }
        if (res.done) break;
    }

    return balance;
}


async _transfer(ctx, from, to, amount) {
    this._logInvocation("transfer", arguments, ctx);
    console.log("🚀 Function `transfer` invoked");
    console.log(`🔁 Initiating transfer from ${from} to ${to} of ₹${amount}`);

    const txId = ctx.stub.getTxID();
    const timestamp = new Date().toISOString();
    const parsedAmount = parseFloat(amount);

    if (isNaN(parsedAmount) || parsedAmount <= 0) {
        throw new Error(`Invalid transfer amount: ${amount}`);
    }

    // Compute current balances by reading all past transactions
    const fromBalance = await this.getWalletBalance(ctx, ...from.split('.'));
    const toBalance = await this.getWalletBalance(ctx, ...to.split('.'));

    if (fromBalance < parsedAmount) throw new Error('❌ Insufficient balance');

    // Create composite keys for transfer log
    const fromTxKey = ctx.stub.createCompositeKey('walletTx', [from, txId, 'debit']);
    const toTxKey = ctx.stub.createCompositeKey('walletTx', [to, txId, 'credit']);

    const debitEntry = {
        type: 'debit',
        delta: -parsedAmount,
        from,
        to,
        timestamp
    };

    const creditEntry = {
        type: 'credit',
        delta: parsedAmount,
        from,
        to,
        timestamp
    };

    await ctx.stub.putState(fromTxKey, Buffer.from(JSON.stringify(debitEntry)));
    await ctx.stub.putState(toTxKey, Buffer.from(JSON.stringify(creditEntry)));

    console.log(`✅ Transferred ₹${amount} from ${from} to ${to} (txId: ${txId})`);
    return `Transferred ₹${amount} from ${from} to ${to}`;
}




  // ====================== PRODUCE ======================
  async submitProduce(ctx, lotId, farmerId, weightKg, lotDate, bags, aggregatorId) {
    this._logInvocation("submitProduce", arguments, ctx);
    console.log("🚀 Function `submitProduce` invoked");
    this._requireOrg(ctx, 'FarmersMSP');

    const feeKey = ctx.stub.createCompositeKey('testingFee', [aggregatorId]);
    const feeData = await ctx.stub.getState(feeKey);
    console.log("📦 Raw feeData buffer:", feeData);
    console.log("📦 Raw feeData string:", feeData.toString());

    if (!feeData || feeData.length === 0) {
      throw new Error(`❌ Aggregator fee not set for ID ${aggregatorId}`);
    }

    let fee;
    try {
      const feeObj = JSON.parse(feeData.toString());
      fee = feeObj.feeAmount;
      if (typeof fee !== 'number') throw new Error('feeAmount is not a number');
    } catch (err) {
      throw new Error(`❌ Failed to parse testing fee for ${aggregatorId}: ${err.message}`);
    }

    await this._transfer(ctx, `farmers.${farmerId}`, `aggregators.${aggregatorId}`, fee);

    const lot = {
      lotId,
      farmerId,
      owner: farmerId,
      weightKg: parseFloat(weightKg),
      lotDate,
      bags: parseInt(bags),
      aggregatorId,
      status: 'SUBMITTED',
      docType: 'lot',
      submittedAt: new Date().toISOString(),
      testingFee: fee,
      offers: []
    };

    const lotKey = ctx.stub.createCompositeKey('lot', [lotId]);
    await ctx.stub.putState(lotKey, Buffer.from(JSON.stringify(lot)));
    return `Lot ${lotId} submitted with aggregator ${aggregatorId}`;
  }

  async testCardamom(ctx, lotId, result, videoHash, gradingJson) {
    this._logInvocation("testCardamom", arguments, ctx);
    console.log("🚀 Function `testCardamom` invoked");
  this._requireOrg(ctx, 'AggregatorsMSP');

  const lotKey = ctx.stub.createCompositeKey('lot', [lotId]);
  const lotBytes = await ctx.stub.getState(lotKey);
  if (!lotBytes || lotBytes.length === 0) throw new Error('Lot not found');

  const lot = JSON.parse(lotBytes.toString());

  // Basic test info
  lot.status = result === 'pass' ? 'APPROVED' : 'REJECTED';
  lot.testResult = result;
  lot.testedAt = new Date().toISOString();
  lot.videoHash = videoHash;

  // Optional grading details
  if (gradingJson) {
    const grading = JSON.parse(gradingJson);

    // Validate sizeGrades
    if (!grading.sizeGrades || typeof grading.sizeGrades !== 'object') {
      throw new Error("Missing or invalid 'sizeGrades' field in grading data");
    }

    // Optionally validate size ranges and required fields
    for (const [size, breakdown] of Object.entries(grading.sizeGrades)) {
      const { clean, sick, split, total } = breakdown;
      if (
        clean === undefined ||
        sick === undefined ||
        split === undefined ||
        total === undefined
      ) {
        throw new Error(`Missing grading fields for size category: ${size}`);
      }
    }

    // Validate quality and metric fields
    const requiredQuality = ['greenPercent', 'averagePercent', 'fruitPercent', 'belowAveragePercent'];
    const requiredMetrics = ['literWeight', 'moisture', 'numberOfBags', 'netWeight'];

    for (const field of requiredQuality) {
      if (grading[field] === undefined) {
        throw new Error(`Missing quality field: ${field}`);
      }
    }

    for (const field of requiredMetrics) {
      if (grading[field] === undefined) {
        throw new Error(`Missing metric field: ${field}`);
      }
    }

    // Assign grading data to the lot
    lot.grading = {
      sizeGrades: grading.sizeGrades,
      quality: {
        greenPercent: grading.greenPercent,
        averagePercent: grading.averagePercent,
        fruitPercent: grading.fruitPercent,
        belowAveragePercent: grading.belowAveragePercent,
      },
      metrics: {
        literWeight: grading.literWeight,
        moisture: grading.moisture,
        numberOfBags: grading.numberOfBags,
        netWeight: grading.netWeight,
      }
    };
  }

  await ctx.stub.putState(lotKey, Buffer.from(JSON.stringify(lot)));
  return `Lot ${lotId} tested as ${lot.status}${gradingJson ? ' with grading details' : ''}`;
}

  // ====================== MARKET OFFERS ======================
  async makeOffer(ctx, lotId, retailerId, offerPrice) {
    this._logInvocation("makeOffer", arguments, ctx);
    console.log("🚀 Function `makeOffer` invoked");
    this._requireOrg(ctx, 'RetailersMSP');

    const lotKey = ctx.stub.createCompositeKey('lot', [lotId]);
    const lotBytes = await ctx.stub.getState(lotKey);
    if (!lotBytes || lotBytes.length === 0) throw new Error('Lot not found');

    const lot = JSON.parse(lotBytes.toString());
    if (lot.status !== 'APPROVED' && lot.status !== 'purchase-requested') {
        throw new Error('Offers can only be made on lots that are approved or already have ongoing offers');
    }

    const newPricePerKg = parseFloat(offerPrice);
    if (isNaN(newPricePerKg) || newPricePerKg <= 0) {
        throw new Error('Invalid offer price');
    }

    const totalOfferAmount = newPricePerKg * lot.weightKg;

    // Get wallet balance of the retailer
    const walletKey = `retailers-${retailerId}-wallet`;
    const walletBytes = await ctx.stub.getState(walletKey);
    if (!walletBytes || walletBytes.length === 0) throw new Error('Retailer wallet not found');

    const wallet = JSON.parse(walletBytes.toString());
    if (wallet.balance < totalOfferAmount) {
        throw new Error(`Insufficient funds. Wallet balance: ₹${wallet.balance}, Required: ₹${totalOfferAmount}`);
    }

    // Optional: check if there's already a higher offer for this lot
    const iterator = await ctx.stub.getStateByPartialCompositeKey('offer', [lotId]);
    

    let maxOfferPerKg = 0;

while (true) {
    const res = await iterator.next();
    if (res.done) {
        break;
    }

    const existingOffer = JSON.parse(res.value.value.toString());
    if (existingOffer.offerPrice > maxOfferPerKg) {
        maxOfferPerKg = existingOffer.offerPrice;
    }
}

await iterator.close();
const txTimestamp = ctx.stub.getTxTimestamp();
const timestamp1 = new Date(txTimestamp.seconds.toNumber() * 1000).toISOString();


    if (newPricePerKg <= maxOfferPerKg) {
        throw new Error(`Offer per kg must be higher than current highest ₹${maxOfferPerKg}`);
    }

    // ✅ Save new offer using composite key
    const offerKey = ctx.stub.createCompositeKey('offer', [lotId, retailerId]);
    const newOffer = {
        retailerId,
        offerPrice: newPricePerKg,
        totalAmount: totalOfferAmount,
        timestamp: timestamp1
    };

    // 🔑 Composite key for this retailer’s offer on this lot
    

    // 🗑️ Delete previous offer by the same retailer (if exists)
    const existingOfferBytes = await ctx.stub.getState(offerKey);
    if (existingOfferBytes && existingOfferBytes.length > 0) {
        await ctx.stub.deleteState(offerKey);
    }


    await ctx.stub.putState(offerKey, Buffer.from(JSON.stringify(newOffer)));

    return `✅ Offer placed: ₹${newPricePerKg}/kg for lot ${lotId} by ${retailerId} (Total ₹${totalOfferAmount})`;
}


async getHighestOfferForLot(ctx, lotId) {
    this._logInvocation("getHighestOfferForLotDetailed", arguments, ctx);

    if (!lotId) {
        throw new Error("lotId is required");
    }

    const iterator = await ctx.stub.getStateByPartialCompositeKey('offer', [lotId]);

    let highestOffer = {
        offerPrice: 0,
        retailerId: null
    };

    while (true) {
        const res = await iterator.next();
        if (res.done) {
            break;
        }

        const offer = JSON.parse(res.value.value.toString());

        if (
            offer.offerPrice !== undefined &&
            Number(offer.offerPrice) > highestOffer.offerPrice
        ) {
            highestOffer.offerPrice = Number(offer.offerPrice);
            highestOffer.retailerId = offer.retailerId;
        }
    }

    await iterator.close();

    return JSON.stringify(highestOffer);
}


  async acceptOffer(ctx, lotId, selectedRetailerId) {
  this._logInvocation("acceptOffer", arguments, ctx);
  console.log("🚀 Function `acceptOffer` invoked");
  this._requireOrg(ctx, 'FarmersMSP');

  const lotKey = ctx.stub.createCompositeKey('lot', [lotId]);
  const lotBytes = await ctx.stub.getState(lotKey);
  if (!lotBytes || lotBytes.length === 0) {
    throw new Error(`❌ Lot ${lotId} not found`);
  }

  const lot = JSON.parse(lotBytes.toString());

  // ❗ Ensure only APPROVED lots can be sold
  if (lot.status !== "APPROVED" && lot.status !== "purchase-requested") {
    throw new Error(`❌ Only APPROVED lots can be sold. Current status is '${lot.status}'`);
  }

  // 🔍 Fetch all offers from ledger using partial composite key
  const offerIterator = await ctx.stub.getStateByPartialCompositeKey('offer', [lotId]);
  const offers = [];

  

  while (true) {
      const res = await offerIterator.next();
      if (res.done) {
          break;
      }

      const offer = JSON.parse(res.value.value.toString());
      offers.push(offer);
  }

  await offerIterator.close();


  if (offers.length === 0) {
    throw new Error(`❌ No offers found on-chain for lot ${lotId}`);
  }

  // 🔼 Sort offers by offerPrice
  offers.sort((a, b) => b.offerPrice - a.offerPrice);
  const highestOffer = offers[0];

  if (highestOffer.retailerId !== selectedRetailerId) {
    throw new Error(`❌ Only the highest offer from '${highestOffer.retailerId}' (₹${highestOffer.offerPrice}) can be accepted`);
  }

  const totalAmount = parseFloat(highestOffer.offerPrice) * parseFloat(lot.weightKg);

  // 💰 Transfer money from retailer to farmer
  await this._transfer(ctx, `retailers.${selectedRetailerId}`, `farmers.${lot.farmerId}`, totalAmount);

  // 📝 Update lot ownership and status
  lot.owner = selectedRetailerId;
  lot.status = 'SOLD';
  lot.soldAt = new Date().toISOString();
  lot.totalPrice = totalAmount;
  lot.acceptedOffer = highestOffer;

  // After lot becomes SOLD
  const packKey = ctx.stub.createCompositeKey(
    'packableLot',
    [selectedRetailerId, lotId]
  );

  await ctx.stub.putState(packKey, Buffer.from(JSON.stringify({
    lotId,
    weightKg: lot.weightKg,
    packed: false
  })));


  // 🧹 Remove all composite-key offers for this lot
  

  await ctx.stub.putState(lotKey, Buffer.from(JSON.stringify(lot)));

  return `✅ Offer accepted. Lot ${lotId} sold to ${selectedRetailerId} for ₹${totalAmount}`;
}



async purchasePacket(ctx, packetId, customerId) {

this._logInvocation("purchasePacket", arguments, ctx);
console.log("🚀 Function `purchasePacket` invoked");
  this._requireOrg(ctx, 'ConsumersMSP');

  const packetKey = ctx.stub.createCompositeKey('packet', [packetId]);
  const packetBytes = await ctx.stub.getState(packetKey);
  if (!packetBytes || packetBytes.length === 0) {
    throw new Error(`Packet ${packetId} not found`);
  }

  const packet = JSON.parse(packetBytes.toString());

  if (packet.status !== 'AVAILABLE') {
    throw new Error(`Packet ${packetId} is not available for purchase`);
  }

  const fromWallet = `consumers.${customerId}`;
  const toWallet = `retailers.${packet.owner}`;
  const price = parseFloat(packet.price);

  // Transfer payment from customer to retailer
  await this._transfer(ctx, fromWallet, toWallet, price);

  // Update packet status and ownership
  packet.owner = customerId;
  packet.status = 'PURCHASED';
  packet.soldAt = new Date().toISOString();

  // Add to packet trace if applicable
  if (!packet.trace) {
    packet.trace = {};
  }
  packet.trace.purchasedBy = customerId;
  packet.trace.purchasedAt = packet.soldAt;

  await ctx.stub.putState(packetKey, Buffer.from(JSON.stringify(packet)));

  return `✅ Packet ${packetId} purchased by ${customerId} for ₹${price}`;
}


  // ====================== FEES ======================
  async setTestingFee(ctx, aggregatorId, feeAmount) {
    this._requireOrg(ctx, 'AggregatorsMSP');
    console.log("🚀 Function `setTestingFee` invoked");
    const key = ctx.stub.createCompositeKey('testingFee', [aggregatorId]);
    const fee = {
      aggregatorId,
      feeAmount: parseFloat(feeAmount),
      updatedAt: new Date().toISOString()
    };
    await ctx.stub.putState(key, Buffer.from(JSON.stringify(fee)));
    return `Testing fee for ${aggregatorId} set to ₹${feeAmount}`;
  }


  async packLotIntoPackets(ctx, lotId, price1kg, price500g, price250g, price100g, packingVideoHash) {
  this._logInvocation("packLotIntoPackets", arguments, ctx);
  console.log("🚀 Function `packLotIntoPackets` invoked");
  this._requireOrg(ctx, 'RetailersMSP');

  const lotKey = ctx.stub.createCompositeKey('lot', [lotId]);
  const lotBytes = await ctx.stub.getState(lotKey);
  if (!lotBytes || lotBytes.length === 0) throw new Error('Lot not found');

  const lot = JSON.parse(lotBytes.toString());

  if (lot.status === 'PACKED') {
    throw new Error(`Lot ${lotId} already packed`);
  }

  if (lot.status !== 'APPROVED' && lot.status !== 'SOLD') {
    throw new Error('Lot must be APPROVED or SOLD to be packed');
  }

  const totalWeight = lot.weightKg * 1000; // convert to grams
  const breakdown = {
    "1000g": Math.floor(totalWeight * 0.10 / 1000),
    "500g": Math.floor(totalWeight * 0.20 / 500),
    "250g": Math.floor(totalWeight * 0.30 / 250),
    "100g": Math.floor(totalWeight * 0.40 / 100)
  };

  const prices = {
    "1000g": parseFloat(price1kg),
    "500g": parseFloat(price500g),
    "250g": parseFloat(price250g),
    "100g": parseFloat(price100g)
  };

  let counter = 1;
  const packetCounts = {};
  const now = new Date().toISOString();
  const putOps = [];

  for (const size in breakdown) {
    packetCounts[size] = 0;

    for (let i = 0; i < breakdown[size]; i++) {
      const packetId = `${lotId}-PKT-${counter}`;
      const packetKey = ctx.stub.createCompositeKey('packet', [packetId]);

      const packet = {
        packetId,
        weight: size,
        price: prices[size],
        qrCode: packetId,
        owner: lot.owner,
        lotRef: lotId,
        status: 'AVAILABLE',
        packedAt: now,
        videoHash: {
          testing: lot.videoHash || null,
          packing: packingVideoHash
        },
        trace: {
          farmerId: lot.farmerId,
          submittedAt: lot.submittedAt || null,
          aggregatorId: lot.aggregatorId || null,
          testedBy: "aggregators." + lot.aggregatorId,
          testedAt: lot.testedAt || null,
          testingVideoHash: lot.videoHash || null,
          testResult: lot.testResult || null,
          packedBy: "retailers." + lot.owner,
          packedAt: now,
          packingVideoHash
        }
      };

      putOps.push(ctx.stub.putState(packetKey, Buffer.from(JSON.stringify(packet))));
      counter++;
      packetCounts[size]++;
    }
  }

  lot.packetCounts = packetCounts;
  lot.status = 'PACKED';

  putOps.push(ctx.stub.putState(lotKey, Buffer.from(JSON.stringify(lot))));
  await Promise.all(putOps);

  return `✅ Packed ${lotId} into ${counter - 1} packets`;
}


async getPacketHistory(ctx, packetId) {
this._logInvocation("getPacketHistory", arguments, ctx);
console.log("🚀 Function `getPacketHistory` invoked");
  const packetKey = ctx.stub.createCompositeKey('packet', [packetId]);
  const iterator = await ctx.stub.getHistoryForKey(packetKey);

  const history = [];
  while (true) {
    const res = await iterator.next();
    if (res.value) {
      let parsedValue = null;

      try {
        parsedValue = JSON.parse(res.value.value.toString('utf8'));
      } catch (e) {
        parsedValue = { raw: res.value.value.toString('utf8') };
      }

      const tx = {
        txId: res.value.txId,
        timestamp: res.value.timestamp,
        isDelete: res.value.isDelete,
        action: res.value.isDelete ? "DELETED" : "UPDATED",
        packetId: packetId,
        weight: parsedValue?.weight || null,
        price: parsedValue?.price || null,
        owner: parsedValue?.owner || null,
        status: parsedValue?.status || null,
        packedAt: parsedValue?.packedAt || null,
        lotRef: parsedValue?.lotRef || null,
        videoHash: parsedValue?.videoHash || null,
        trace: parsedValue?.trace || {},
        fullRecord: parsedValue
      };

      history.push(tx);
    }

    if (res.done) break;
  }

  await iterator.close();
  return JSON.stringify(history);
}


async purchasePacket(ctx, packetId, customerId) {
this._logInvocation("purchasePacket", arguments, ctx);
console.log("🚀 Function `purchasePacket invoked");
  this._requireOrg(ctx, 'ConsumersMSP');

  const packetKey = ctx.stub.createCompositeKey('packet', [packetId]);
  const packetBytes = await ctx.stub.getState(packetKey);
  if (!packetBytes || packetBytes.length === 0) throw new Error(`Packet ${packetId} not found`);

  const packet = JSON.parse(packetBytes.toString());

  if (packet.status !== 'AVAILABLE') {
    throw new Error(`Packet ${packetId} is not available for purchase`);
  }

  const fromWallet = `retailers.${packet.owner}`;
  const toWallet = `consumers.${customerId}`;
  const price = packet.price;

  // Perform payment transfer
  await this._transfer(ctx, toWallet, fromWallet, price);

  // Update packet ownership and status
  packet.owner = customerId;
  packet.status = 'PURCHASED';
  packet.soldAt = new Date().toISOString();

  await ctx.stub.putState(packetKey, Buffer.from(JSON.stringify(packet)));

  return `✅ Packet ${packetId} purchased by ${customerId} for ₹${price}`;
}
async getFarmerRating(ctx, farmerId) {
this._logInvocation("getFarmerRating", arguments, ctx);
console.log("🚀 Function `getFarmerRating invoked");
  const iterator = await ctx.stub.getStateByPartialCompositeKey('lot', []);
  let total = 0;
  let rejected = 0;

  while (true) {
    const res = await iterator.next();
    if (res.value && res.value.value.toString()) {
      const lot = JSON.parse(res.value.value.toString());

      if (lot.farmerId === farmerId) {
        total++;
        if (lot.status === 'REJECTED') {
          rejected++;
        }
      }
    }

    if (res.done) {
      await iterator.close();
      break;
    }
  }

  const rating = total === 0 ? 0 : Math.round(((total - rejected) / total) * 100);
  return JSON.stringify({ farmerId, total, rejected, rating });
}



  async getTestingFee(ctx, aggregatorId) {
    this._logInvocation("getTestingFee", arguments, ctx);
    console.log("🚀 Function `getTestingFee invoked");
    const key = ctx.stub.createCompositeKey('testingFee', [aggregatorId]);
    const data = await ctx.stub.getState(key);
    if (!data || data.length === 0) throw new Error('Fee not set');
    return data.toString();
  }

  // ====================== QUERIES ======================
async getAllProduce(ctx, limit) {

  this._logInvocation("getAllProduce", arguments, ctx);
  console.log("🚀 Function `getAllProduce` invoked");

  const iterator = await ctx.stub.getStateByPartialCompositeKey('lot', []);
  const results = [];

  let count = 0;
  const maxRecords = limit ? parseInt(limit) : Number.MAX_SAFE_INTEGER;

  while (true) {

    const res = await iterator.next();

    if (res.value && res.value.value.toString()) {

      results.push(JSON.parse(res.value.value.toString('utf8')));

      count++;

      if (count >= maxRecords) {
        break;
      }
    }

    if (res.done) break;
  }

  await iterator.close();

  const payload = JSON.stringify(results);
  const payloadSize = Buffer.byteLength(payload, 'utf8');

  return JSON.stringify({
    recordCount: results.length,
    payloadSizeBytes: payloadSize,
    data: results
  });
}
 
async getAllProduce1(ctx) {

    this._logInvocation("getAllProduce", arguments, ctx);
    console.log("🚀 Function `getAllProduce` invoked");

    const iterator = await ctx.stub.getStateByPartialCompositeKey('lot', []);
    const results = [];

    while (true) {

        const res = await iterator.next();

        if (res.value && res.value.value.toString()) {

            const record = JSON.parse(res.value.value.toString('utf8'));
            results.push(record);
        }

        if (res.done) {
            break;
        }
    }

    await iterator.close();

    const payload = JSON.stringify(results);
    const payloadSize = Buffer.byteLength(payload, 'utf8');

    return JSON.stringify({
        recordCount: results.length,
        payloadSizeBytes: payloadSize,
        data: results
    });
}

async getRandomLotByStatusAndOwner(ctx, status, owner) {
    this._logInvocation("getRandomLotByStatusAndOwner", arguments, ctx);

    if (!status || !owner) {
        throw new Error("Both status and owner are required");
    }

    // 🔒 Bounded scan for safety
    const iterator = await ctx.stub.getStateByPartialCompositeKey('lot', []);
    const candidates = [];
    const MAX_CANDIDATES = 20;

    try {
        while (candidates.length < MAX_CANDIDATES) {
            const res = await iterator.next();
            if (res.done) break;

            let lot;
            try {
                lot = JSON.parse(res.value.value.toString('utf8'));
            } catch (e) {
                // Skip malformed entries
                continue;
            }

            // ✅ Filter by BOTH status and owner
            if (lot.status === status && lot.owner === owner) {
                candidates.push(lot);
            }
        }
    } finally {
        // ✅ Always close iterator
        await iterator.close();
    }

    if (candidates.length === 0) {
        return JSON.stringify(null);
    }

    const randomIndex = Math.floor(Math.random() * candidates.length);
    return JSON.stringify(candidates[randomIndex]);
}

async getRandomPackableLotByRetailer(ctx, retailerId) {
    if (!retailerId) {
        throw new Error("retailerId is required");
    }

    const iterator = await ctx.stub.getStateByPartialCompositeKey('lot', []);
    let selected = null;

    try {
        while (true) {
            const res = await iterator.next();
            if (res.done) {
                break;
            }

            let lot;
            try {
                lot = JSON.parse(res.value.value.toString('utf8'));
            } catch {
                continue; // skip malformed entries
            }

            // ✅ Filter by SOLD status and owner
            if (lot.status === 'SOLD' && lot.owner === retailerId) {
                selected = lot;
                break; // take the first matching lot
            }
        }
    } finally {
        // 🔒 Mandatory iterator cleanup
        await iterator.close();
    }

    return selected ? JSON.stringify(selected) : JSON.stringify(null);
}




async getRandomLotHighestOfferByStatusAndOwner(ctx, status, ownerId) {
    this._logInvocation(
        "getRandomLotHighestOfferByStatusAndOwner",
        arguments,
        ctx
    );

    if (!status || !ownerId) {
        throw new Error("status and ownerId are required");
    }

    /* --------------------------------
       1. Collect matching lots (bounded)
    -------------------------------- */
    const lotIterator = await ctx.stub.getStateByPartialCompositeKey('lot', []);
    const matchingLots = [];
    const MAX_LOTS = 20;

    try {
        while (matchingLots.length < MAX_LOTS) {
            const res = await lotIterator.next();
            if (res.done) break;

            let lot;
            try {
                lot = JSON.parse(res.value.value.toString('utf8'));
            } catch (e) {
                continue; // skip corrupted entries safely
            }

            if (lot.status === status && lot.owner === ownerId) {
                matchingLots.push(lot);
            }
        }
    } finally {
        await lotIterator.close(); // 🔒 mandatory
    }

    if (matchingLots.length === 0) {
        return JSON.stringify(null);
    }

    /* --------------------------------
       2. Deterministic selection (TxID)
    -------------------------------- */
    const txId = ctx.stub.getTxID();
    const index =
        parseInt(txId.slice(-6), 16) % matchingLots.length;

    const lot = matchingLots[index];

    /* --------------------------------
       3. Highest offer (bounded scan)
    -------------------------------- */
    const offerIterator = await ctx.stub.getStateByPartialCompositeKey(
        'offer',
        [lot.lotId]
    );

    let highestOffer = null;
    const MAX_OFFERS = 50;

    try {
        let count = 0;
        while (count < MAX_OFFERS) {
            const res = await offerIterator.next();
            if (res.done) break;

            let offer;
            try {
                offer = JSON.parse(res.value.value.toString('utf8'));
            } catch (e) {
                continue;
            }

            if (
                !highestOffer ||
                Number(offer.offerPrice) > Number(highestOffer.offerPrice)
            ) {
                highestOffer = offer;
            }
            count++;
        }
    } finally {
        await offerIterator.close(); // 🔒 mandatory
    }

    if (!highestOffer || !highestOffer.retailerId) {
        return JSON.stringify(null);
    }

    /* --------------------------------
       4. Stable return
    -------------------------------- */
    return JSON.stringify({
        lotId: lot.lotId,
        highestOffer: {
            retailerId: highestOffer.retailerId,
            offerPrice: Number(highestOffer.offerPrice)
        }
    });
}


async getAllLotsWithOffers(ctx) {
    this._logInvocation("getAllLotsWithOffers", arguments, ctx);

    const results = [];
    const lotIterator = await ctx.stub.getStateByPartialCompositeKey('lot', []);

    while (true) {
        const lotRes = await lotIterator.next();
        if (lotRes.done) break;

        const lot = JSON.parse(lotRes.value.value.toString());
        const lotId = lot.lotId;

        const offerIterator = await ctx.stub.getStateByPartialCompositeKey('offer', [lotId]);
        const offers = [];

        let highestOffer = {
            offerPrice: 0,
            retailerId: null
        };

        while (true) {
            const offerRes = await offerIterator.next();
            if (offerRes.done) break;

            const offer = JSON.parse(offerRes.value.value.toString());
            offers.push(offer);

            if (
                offer.offerPrice !== undefined &&
                Number(offer.offerPrice) > highestOffer.offerPrice
            ) {
                highestOffer.offerPrice = Number(offer.offerPrice);
                highestOffer.retailerId = offer.retailerId;
            }
        }

        await offerIterator.close();

        results.push({
            ...lot,
            offers,
            highestOffer
        });
    }

    await lotIterator.close();
    return JSON.stringify(results);
}
async getApprovedLotsWithoutOffers(ctx) {
    this._logInvocation("getApprovedLotsWithoutOffers", arguments, ctx);

    const results = [];

    const lotIterator = await ctx.stub.getStateByPartialCompositeKey('lot', []);

    while (true) {
        const lotRes = await lotIterator.next();
        if (lotRes.done) break;

        const lot = JSON.parse(lotRes.value.value.toString());
        const lotId = lot.lotId;

        // ✅ ONLY APPROVED lots
        if (lot.status !== 'APPROVED') {
            continue;
        }
        // 🔍 Check if any offer exists
        const offerIterator = await ctx.stub.getStateByPartialCompositeKey('offer', [lotId]);

        let hasOffer = false;

        while (true) {
            const offerRes = await offerIterator.next();
            if (offerRes.done) break;

            hasOffer = true;
            break; // stop early
        }

        await offerIterator.close();

        // ✅ Include ONLY if NO offers
        if (!hasOffer) {
            results.push(lot);
        }
    }

    await lotIterator.close();

    return JSON.stringify(results);
}
async getAllLotsWithOffers(ctx, limit) {

    this._logInvocation("getAllLotsWithOffers", arguments, ctx);

    const results = [];

    const lotIterator = await ctx.stub.getStateByPartialCompositeKey('lot', []);

    const maxRecords = limit ? parseInt(limit) : 20;
    let count = 0;

    while (true) {

        const lotRes = await lotIterator.next();

        if (lotRes.done) break;

        if (!lotRes.value || !lotRes.value.value) continue;

        const lot = JSON.parse(lotRes.value.value.toString());
        const lotId = lot.lotId;

        const offerIterator = await ctx.stub.getStateByPartialCompositeKey('offer', [lotId]);

        const offers = [];

        let highestOffer = {
            offerPrice: 0,
            retailerId: null
        };

        while (true) {

            const offerRes = await offerIterator.next();

            if (offerRes.done) break;

            if (!offerRes.value || !offerRes.value.value) continue;

            const offer = JSON.parse(offerRes.value.value.toString());

            offers.push(offer);

            if (
                offer.offerPrice !== undefined &&
                Number(offer.offerPrice) > highestOffer.offerPrice
            ) {
                highestOffer.offerPrice = Number(offer.offerPrice);
                highestOffer.retailerId = offer.retailerId;
            }
        }

        await offerIterator.close();

        // Only include lots that have offers
        if (offers.length > 0) {

            results.push({
                ...lot,
                offers,
                highestOffer
            });

            count++;

            if (count >= maxRecords) {
                break;
            }
        }
    }

    await lotIterator.close();

    return JSON.stringify(results);
}



async getRandomLotWithoutOfferByStatusAndRetailer(ctx, status, retailerId) {
    this._logInvocation(
        "getRandomLotWithoutOfferByStatusAndRetailer",
        arguments,
        ctx
    );

    if (!status || !retailerId) {
        throw new Error("status and retailerId are required");
    }

    const candidates = [];
    const MAX_CANDIDATES = 20; // safety cap

    const lotIterator = await ctx.stub.getStateByPartialCompositeKey('lot', []);

    try {
        while (candidates.length < MAX_CANDIDATES) {
            const lotRes = await lotIterator.next();
            if (lotRes.done) break;

            let lot;
            try {
                lot = JSON.parse(lotRes.value.value.toString('utf8'));
            } catch {
                continue; // skip malformed entries
            }

            // ✅ Filter by status and owner
            if (lot.status !== status || lot.owner !== retailerId) {
                continue;
            }

            const lotId = lot.lotId;

            // 🔍 Check if ANY offer exists for this lot
            const offerIterator =
                await ctx.stub.getStateByPartialCompositeKey('offer', [lotId]);

            const offerRes = await offerIterator.next();
            await offerIterator.close();

            // ❌ Skip lots that already have offers
            if (!offerRes.done) {
                continue;
            }

            // ✅ Lot has NO offers
            candidates.push(lot);
        }
    } finally {
        await lotIterator.close();
    }

    if (candidates.length === 0) {
        return JSON.stringify(null);
    }

    // 🎯 Random selection
    const randomIndex = Math.floor(Math.random() * candidates.length);
    return JSON.stringify(candidates[randomIndex]);
}


async getAllPackets(ctx, status, limit) {

    const iterator = await ctx.stub.getStateByPartialCompositeKey('packet', []);
    const packets = [];

    const maxRecords = limit ? parseInt(limit) : 50;
    let count = 0;

    while (true) {

        const res = await iterator.next();

        if (res.value && res.value.value.toString()) {

            const packet = JSON.parse(res.value.value.toString('utf8'));

            // filter by status if provided
            if (!status || packet.status === status) {

                packets.push(packet);
                count++;

                if (count >= maxRecords) {
                    break;
                }
            }
        }

        if (res.done) {
            break;
        }
    }

    await iterator.close();

    return JSON.stringify(packets);
}
async getAllPackets1(ctx, limit) {

    const iterator = await ctx.stub.getStateByPartialCompositeKey('packet', []);
    const packets = [];

    const maxRecords = limit ? parseInt(limit) : 50;
    let count = 0;

    while (true) {

        const res = await iterator.next();

        if (res.value && res.value.value.toString()) {

            const packet = JSON.parse(res.value.value.toString('utf8'));
            packets.push(packet);

            count++;

            if (count >= maxRecords) {
                break;
            }
        }

        if (res.done) {
            break;
        }
    }

    await iterator.close();

    return JSON.stringify(packets);
}

async getRandomAvailablePacket(ctx) {
    this._logInvocation("getRandomAvailablePacket", arguments, ctx);

    const iterator = await ctx.stub.getStateByPartialCompositeKey('packet', []);
    const candidates = [];
    const MAX_PACKETS = 20; // safety bound

    try {
        while (candidates.length < MAX_PACKETS) {
            const res = await iterator.next();
            if (res.done) break;

            let packet;
            try {
                packet = JSON.parse(res.value.value.toString('utf8'));
            } catch (err) {
                continue; // skip malformed entries safely
            }

            if (packet.status === 'AVAILABLE') {
                candidates.push(packet);
            }
        }
    } finally {
        // 🔒 mandatory iterator cleanup
        await iterator.close();
    }

    if (candidates.length === 0) {
        return JSON.stringify(null);
    }

    /* --------------------------------
       Deterministic "random" selection
       (TxID-based, endorsement-safe)
    -------------------------------- */
    const txId = ctx.stub.getTxID();
    const index =
        parseInt(txId.slice(-6), 16) % candidates.length;

    return JSON.stringify(candidates[index]);
}


async acceptDummyOffer(ctx) {

    return JSON.stringify({
        message: "Dummy transaction executed"
    });
}



  async getStats(ctx) {
  const lotIterator = await ctx.stub.getStateByPartialCompositeKey('lot', []);
  const packetIterator = await ctx.stub.getStateByPartialCompositeKey('packet', []);

  let stats = {
    totalWeight: 0,
    submittedLotsCount: 0,
    rejectedWeight: 0,
    awaitingApprovalWeight: 0,
    approvedWeight: 0,
    soldWeight: 0,
    purchasedWeight: 0,
    packedWeight: 0,
    awaitingTestCount: 0,
    testedApprovedLotsCount: 0,
    rejectedLotsCount: 0,
    createdPacketCounts: { "100": 0, "250": 0, "500": 0, "1000": 0 },
    topFarmer: ""
  };

  const farmerRatings = {};

  // ---- Process LOTS ----
  while (true) {
    const res = await lotIterator.next();
    if (res.value && res.value.value.toString()) {
      const lot = JSON.parse(res.value.value.toString('utf8'));
      const weight = lot.weightKg || 0;

      stats.totalWeight += weight;
      stats.submittedLotsCount++;

      switch (lot.status) {
        case "SUBMITTED":
          stats.awaitingTestCount++;
          stats.awaitingApprovalWeight += weight;
          break;
        case "REJECTED":
          stats.rejectedWeight += weight;
          stats.rejectedLotsCount++;
          break;
        case "APPROVED":
          stats.testedApprovedLotsCount++;
          break;
        case "purchase-requested":
  
          stats.testedApprovedLotsCount++;
          break;

        case "SOLD":
          stats.soldWeight += weight;
          stats.testedApprovedLotsCount++;

          case "PACKED":
          stats.soldWeight += weight;
          stats.testedApprovedLotsCount++;
          break;
      }

      if (lot.farmerId && typeof lot.rating === "number") {
        if (!farmerRatings[lot.farmerId]) farmerRatings[lot.farmerId] = [];
        farmerRatings[lot.farmerId].push(lot.rating);
      }
    }
    if (res.done) break;
  }
  await lotIterator.close();

  // ---- Process PACKETS ----
  while (true) {
    const res = await packetIterator.next();
    if (res.value && res.value.value.toString()) {
      const packet = JSON.parse(res.value.value.toString('utf8'));

      // Parse weight from string like "100g"
      let weight = 0;
      if (typeof packet.weight === "string") {
        weight = parseInt(packet.weight.replace("g", ""));
      }

      stats.packedWeight += weight;

      const size = `${weight}`;
      if (stats.createdPacketCounts[size] !== undefined) {
        stats.createdPacketCounts[size] += 1;
      }

      if (packet.status === "PURCHASED") {
        stats.purchasedWeight += weight / 1000; // convert grams to kg
      }
    }
    if (res.done) break;
  }
  await packetIterator.close();

  // ---- Derived Approved Weight ----
  stats.approvedWeight = stats.totalWeight - stats.rejectedWeight - stats.awaitingApprovalWeight;

  // ---- Top-rated Farmer ----
  let maxAvg = -1;
  for (const farmerId in farmerRatings) {
    const ratings = farmerRatings[farmerId];
    const avg = ratings.reduce((a, b) => a + b, 0) / ratings.length;
    if (avg > maxAvg) {
      maxAvg = avg;
      stats.topFarmer = farmerId;
    }
  }

  return JSON.stringify(stats);
}




}

module.exports = SupplyChainContract;
