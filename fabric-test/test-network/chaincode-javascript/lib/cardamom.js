'use strict';

const { Contract } = require('fabric-contract-api');

class SupplyChainContract extends Contract {
  async getMSPID(ctx) {
    return ctx.clientIdentity.getMSPID();
  }

  async submitProduce(ctx, farmerID, cardamomID, harvestDate, weight, area) {
    const mspId = await this.getMSPID(ctx);
    if (mspId !== 'FarmersMSP') {
      throw new Error('Only FarmersMSP members can submit produce');
    }

    const produce = {
      cardamomID,
      farmerID,
      harvestDate,
      weight,
      area,
      submittedAt: new Date().toISOString(),
      status: 'submitted',
      docType: 'produce'
    };

    await ctx.stub.putState(cardamomID, Buffer.from(JSON.stringify(produce)));
  }

  async depositMoney(ctx, farmerID, amount) {
    const mspId = await this.getMSPID(ctx);
    if (mspId !== 'BankMSP') {
      throw new Error('Only BankMSP members can deposit money');
    }

    const key = `farmer-${farmerID}`;
    const farmerAsBytes = await ctx.stub.getState(key);
    let farmer = { rating: 0, balance: 0 };

    if (farmerAsBytes && farmerAsBytes.length > 0) {
      farmer = JSON.parse(farmerAsBytes.toString());
    }

    farmer.balance = (farmer.balance || 0) + parseInt(amount);
    await ctx.stub.putState(key, Buffer.from(JSON.stringify(farmer)));
  }

  async testCardamom(ctx, cardamomID, result, videoHash) {
    const mspId = await this.getMSPID(ctx);
    if (mspId !== 'AggregatorsMSP') {
      throw new Error('Only AggregatorsMSP members can test cardamom');
    }
  
    const produceAsBytes = await ctx.stub.getState(cardamomID);
    if (!produceAsBytes || produceAsBytes.length === 0) {
      throw new Error(`Cardamom ${cardamomID} not found`);
    }
  
    const produce = JSON.parse(produceAsBytes.toString());
    produce.testResult = result;
    produce.testedAt = new Date().toISOString();
    produce.testVideoIPFS = videoHash;
    produce.status = result === 'pass' ? 'approved' : 'rejected';
  
    const farmerKey = `farmer-${produce.farmerID}`;
    const farmerAsBytes = await ctx.stub.getState(farmerKey);
  
    let farmer = {
      rating: 0,
      balance: 0,
      totalLots: 0,
      passedLots: 0
    };
  
    if (farmerAsBytes && farmerAsBytes.length > 0) {
      farmer = JSON.parse(farmerAsBytes.toString());
    }
  
    // Update counters
    farmer.totalLots = (farmer.totalLots || 0) + 1;
    if (result === 'pass') {
      farmer.passedLots = (farmer.passedLots || 0) + 1;
    }
  
    // Calculate rating as percentage
    if (farmer.totalLots > 0) {
      farmer.rating = Math.round((farmer.passedLots / farmer.totalLots) * 100);
    }
  
    // Save updated records
    await ctx.stub.putState(farmerKey, Buffer.from(JSON.stringify(farmer)));
    await ctx.stub.putState(cardamomID, Buffer.from(JSON.stringify(produce)));
  }
  

  async requestPurchase(ctx, cardamomID, retailerID) {
    const mspId = await this.getMSPID(ctx);
    if (mspId !== 'RetailersMSP') {
      throw new Error('Only RetailersMSP members can request purchases');
    }
  
    const produceAsBytes = await ctx.stub.getState(cardamomID);
    if (!produceAsBytes || produceAsBytes.length === 0) {
      throw new Error(`Produce ${cardamomID} not found`);
    }
  
    const produce = JSON.parse(produceAsBytes.toString());
  
    if (produce.status !== 'approved') {
      throw new Error('Only approved produce can be requested for purchase');
    }
  
    produce.status = 'purchase-requested';
    produce.pendingOwner = retailerID;
  
    await ctx.stub.putState(cardamomID, Buffer.from(JSON.stringify(produce)));
  }
  

  async approvePurchase(ctx, cardamomID) {
    const mspId = await this.getMSPID(ctx);
    if (mspId !== 'FarmersMSP') {
      throw new Error('Only FarmersMSP members can approve purchases');
    }

    const produceAsBytes = await ctx.stub.getState(cardamomID);
    const produce = JSON.parse(produceAsBytes.toString());

    if (produce.status !== 'purchase-requested') {
      throw new Error(`No pending purchase request for ${cardamomID}`);
    }

    produce.owner = produce.pendingOwner;
    produce.status = 'purchased';
    delete produce.pendingOwner;

    await ctx.stub.putState(cardamomID, Buffer.from(JSON.stringify(produce)));
  }

  async packCardamom(ctx, cardamomID, videoHash) {
    const mspId = await this.getMSPID(ctx);
    if (mspId !== 'RetailersMSP') {
      throw new Error('Only RetailersMSP members can pack cardamom');
    }
  
    const produceAsBytes = await ctx.stub.getState(cardamomID);
    if (!produceAsBytes || produceAsBytes.length === 0) {
      throw new Error(`Produce ${cardamomID} not found`);
    }
  
    const produce = JSON.parse(produceAsBytes.toString());
    if (produce.status !== 'purchased') {
      throw new Error('Cardamom must be purchased to be packed');
    }
  
    const totalWeightKg = parseFloat(produce.weight);
    const totalWeightGrams = totalWeightKg * 1000;
  
    const distribution = {
      "1000": Math.floor(totalWeightGrams * 0.20 / 1000),
      "500": Math.floor(totalWeightGrams * 0.30 / 500),
      "250": Math.floor(totalWeightGrams * 0.20 / 250)
    };
  
    // Calculate used weight and remaining for 100g packets
    const usedWeight = (distribution["1000"] * 1000) + (distribution["500"] * 500) + (distribution["250"] * 250);
    distribution["100"] = Math.floor((totalWeightGrams - usedWeight) / 100);
  
    const packets = [];
    let counter = 1;
    for (const [size, count] of Object.entries(distribution)) {
      for (let i = 0; i < count; i++) {
        const packetID = `packet-${cardamomID}-${size}g-${Date.now()}-${counter++}`;
        const packet = {
          packetID,
          cardamomID,
          packedAt: new Date().toISOString(),
          packetWeight: size,
          videoHash,
          farmerID: produce.farmerID,
          harvestDate: produce.harvestDate,
          area: produce.area,
          owner: produce.owner,
          status: 'available',
          docType: 'packet'
        };
        await ctx.stub.putState(packetID, Buffer.from(JSON.stringify(packet)));
        packets.push(packetID);
      }
    }
  
    // Optionally mark produce as packed or remove it
    produce.status = 'packed';
    await ctx.stub.putState(cardamomID, Buffer.from(JSON.stringify(produce)));
  
    return JSON.stringify({ packed: packets.length, packetIDs: packets });
  }
  

  async requestPacketPurchase(ctx, packetID, customerID) {
    const mspId = await this.getMSPID(ctx);
    if (mspId !== 'CustomersMSP') {
      throw new Error('Only CustomersMSP members can request packets');
    }

    const packetAsBytes = await ctx.stub.getState(packetID);
    const packet = JSON.parse(packetAsBytes.toString());

    if (packet.status !== 'available') {
      throw new Error(`Packet ${packetID} is not available`);
    }

    packet.status = 'purchase-requested';
    packet.pendingOwner = customerID;

    await ctx.stub.putState(packetID, Buffer.from(JSON.stringify(packet)));
  }

  async approvePacketPurchase(ctx, packetID) {
    const mspId = await this.getMSPID(ctx);
    if (mspId !== 'RetailersMSP') {
      throw new Error('Only RetailersMSP members can approve packet sales');
    }

    const packetAsBytes = await ctx.stub.getState(packetID);
    const packet = JSON.parse(packetAsBytes.toString());

    if (packet.status !== 'purchase-requested') {
      throw new Error(`No pending request for packet ${packetID}`);
    }

    packet.status = 'sold';
    packet.owner = packet.pendingOwner;
    packet.purchasedAt = new Date().toISOString();
    delete packet.pendingOwner;

    await ctx.stub.putState(packetID, Buffer.from(JSON.stringify(packet)));
  }

  async getPacketDetails(ctx, packetID) {
    const packetAsBytes = await ctx.stub.getState(packetID);
    const packet = JSON.parse(packetAsBytes.toString());
  
    const produceAsBytes = await ctx.stub.getState(packet.cardamomID);
    const produce = JSON.parse(produceAsBytes.toString());
  
    return JSON.stringify({
      packet: {
        packetID: packet.packetID,
        cardamomID: packet.cardamomID,
        packetWeight: packet.packetWeight,
        packedAt: packet.packedAt,
        videoHash: packet.videoHash,
        status: packet.status,
        owner: packet.owner,
      },
      produce: {
        area: packet.area,
        harvestDate: packet.harvestDate,
      },
      trace: {
        farmerID: packet.farmerID,
        submittedAt: produce.submittedAt,
        testedAt: produce.testedAt,
        testResult: produce.testResult,
        testVideoIPFS: produce.testVideoIPFS,
        packedAt: packet.packedAt,
      }
    });
  }
  

  async getStats(ctx) {
    const iterator = await ctx.stub.getStateByRange('', '');
    let totalWeight = 0;
    let approvedWeight = 0;
    let rejectedWeight = 0;
    let soldWeight = 0;
    let packedWeight = 0;
    let purchasedWeight = 0;
  
    const packetCounts = { "100": 0, "250": 0, "500": 0 ,"1000": 0 };
    const createdPacketCounts = { "100": 0, "250": 0, "500": 0, "1000": 0 };
  
    const farmerTestStats = {}; // { User1: { approved: x, rejected: y } }
  
    let approvedPacketCount = 0;
    let testedApprovedLotsCount = 0;
    let rejectedLotsCount = 0;
    let awaitingTestCount = 0;
  
    while (true) {
      const res = await iterator.next();
      if (res.value && res.value.value.toString()) {
        const record = JSON.parse(res.value.value.toString());
  
        // ➤ Produce Stats
        if (record.docType === 'produce') {
          const weightKg = parseFloat(record.weight) || 0;
          totalWeight += weightKg;
  
          const farmerID = record.farmerID;
          if (farmerID && !farmerTestStats[farmerID]) {
            farmerTestStats[farmerID] = { approved: 0, rejected: 0 };
          }
  
          if (
            record.status !== 'rejected' &&
            record.status !== 'submitted'
          )
           {
            approvedWeight += weightKg;
            testedApprovedLotsCount++;
            if (farmerID) farmerTestStats[farmerID].approved++;
          } else if (record.status === 'rejected') {
            rejectedWeight += weightKg;
            rejectedLotsCount++;
            if (farmerID) farmerTestStats[farmerID].rejected++;
          } else if (record.status === 'submitted') {
            awaitingTestCount++;
          }
  
          if (record.status === 'purchased' || record.status === 'packed') {
            purchasedWeight += weightKg;
          }
        }
  
        // ➤ Packet Stats
        if (record.docType === 'packet') {
          const grams = parseInt(record.packetWeight) || 0;
  
          createdPacketCounts[record.packetWeight] = (createdPacketCounts[record.packetWeight] || 0) + 1;
          packedWeight += grams;
  
          if (record.status === 'sold') {
            soldWeight += grams;
            packetCounts[record.packetWeight] = (packetCounts[record.packetWeight] || 0) + 1;
          } else if (record.status === 'approved') {
            approvedPacketCount++;
          }
        }
      }
  
      if (res.done) {
        await iterator.close();
        break;
      }
    }
  
    // ➤ Compute dynamic rating and top farmer
    let topFarmer = "";
    let highestRating = 0;
  
    for (const [farmerID, stats] of Object.entries(farmerTestStats)) {
      const total = stats.approved + stats.rejected;
      const rating = total > 0 ? Math.round((stats.approved / total) * 100) : 0;
  
      if (rating > highestRating) {
        highestRating = rating;
        topFarmer = farmerID;
      }
    }
  
    // ➤ Return final stats
    return JSON.stringify({
      totalWeight,
      approvedWeight,
      rejectedWeight,
      purchasedWeight,
      packedWeight,
      soldWeight,
      packetCounts,
      createdPacketCounts,
      topFarmer,
      approvedPacketCount,
      testedApprovedLotsCount,
      rejectedLotsCount,
      awaitingTestCount
    });
  }
  


  async getStatsForFarmer(ctx, userId) {
    const iterator = await ctx.stub.getStateByRange('', '');
    let totalWeight = 0;
    let approvedWeight = 0;
    let rejectedWeight = 0;
    let soldWeight = 0;
    const packetCounts = { "100": 0, "250": 0, "500": 0,"1000": 0 };
    let approvedPacketCount = 0;
    let testedApprovedLotsCount = 0;
    let rejectedLotsCount = 0;
    let awaitingTestCount = 0;
    let personalRating = 0;
  
    while (true) {
      const res = await iterator.next();
      if (res.value && res.value.value.toString()) {
        const record = JSON.parse(res.value.value.toString());
  
        // ➤ PRODUCE STATS
        if (record.docType === 'produce' && record.farmerID === userId) {
          const weightKg = parseFloat(record.weight) || 0;
          totalWeight += weightKg;
  
          if (record.status === 'approved' || record.status === 'purchase-requested' || record.status === 'purchased') {
            approvedWeight += weightKg;
            testedApprovedLotsCount++;
          } else if (record.status === 'rejected') {
            rejectedWeight += weightKg;
            rejectedLotsCount++;
          } else if (record.status === 'submitted') {
            awaitingTestCount++;
          }
        }
  
        // ➤ PACKET STATS
        if (record.docType === 'packet' && record.farmerID === userId) {
          const grams = parseInt(record.packetWeight) || 0;
          if (record.status === 'sold') {
            soldWeight += grams;
            packetCounts[record.packetWeight] = (packetCounts[record.packetWeight] || 0) + 1;
          } else if (record.status === 'approved') {
            approvedPacketCount++;
          }
        }
      }
  
      if (res.done) {
        await iterator.close();
        break;
      }
    }
  
    // ➤ Dynamic rating calculation
    const totalTestedLots = testedApprovedLotsCount + rejectedLotsCount;
    if (totalTestedLots > 0) {
      personalRating = Math.round((testedApprovedLotsCount / totalTestedLots) * 100);
    }
  
    return JSON.stringify({
      totalWeight,
      approvedWeight,
      rejectedWeight,
      soldWeight,
      approvedPacketCount,
      testedApprovedLotsCount,
      rejectedLotsCount,
      awaitingTestCount,
      packetCounts,
      personalRating,
    });
  }
  
  
  
  async getAllProduce(ctx) {
    const iterator = await ctx.stub.getStateByRange('', '');
    const results = [];
    while (true) {
      const res = await iterator.next();
      if (res.value && res.value.value.toString()) {
        const record = JSON.parse(res.value.value.toString());
        if (record.docType === 'produce') {
          results.push(record);
        }
      }
      if (res.done) {
        await iterator.close();
        break;
      }
    }
    return JSON.stringify(results);
  }

  async getAllPackets(ctx) {
    const iterator = await ctx.stub.getStateByRange('', '');
    const results = [];
    while (true) {
      const res = await iterator.next();
      if (res.value && res.value.value.toString()) {
        const record = JSON.parse(res.value.value.toString());
        if (record.docType === 'packet') {
          results.push(record);
        }
      }
      if (res.done) {
        await iterator.close();
        break;
      }
    }
    return JSON.stringify(results);
  }

  async getMyProduce(ctx, farmerID) {
    const mspId = ctx.clientIdentity.getMSPID();
    if (mspId !== 'FarmersMSP') {
      throw new Error('Only FarmersMSP members can access their produce');
    }

    const iterator = await ctx.stub.getStateByRange('', '');
    const results = [];

    while (true) {
      const res = await iterator.next();
      if (res.value && res.value.value.toString()) {
        const record = JSON.parse(res.value.value.toString());
        if (record.docType === 'produce' && record.farmerID === farmerID) {
          results.push(record);
        }
      }
      if (res.done) {
        await iterator.close();
        break;
      }
    }

    return JSON.stringify(results);
  }
}

module.exports = SupplyChainContract;
