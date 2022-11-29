import { expect } from 'chai';
import { ethers } from 'hardhat';
import { utils } from 'ethers';
import { CryptoAnts, CryptoAnts__factory, Egg, Egg__factory } from '@typechained';
import { evm } from '@utils';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/dist/src/signers';

const FORK_BLOCK_NUMBER = 11298165;

describe('CryptoAnts', function () {
  // signers
  let deployer: SignerWithAddress;
  let randomUser: SignerWithAddress;

  // factories
  let cryptoAntsFactory: CryptoAnts__factory;
  let eggFactory: Egg__factory;

  // contracts
  let cryptoAnts: CryptoAnts;
  let egg: Egg;

  // misc
  let eggPrecalculatedAddress: string;
  let snapshotId: string;

  before(async () => {
    // forking mainnet
    await evm.reset({
      jsonRpcUrl: process.env.RPC_ROPSTEN,
      blockNumber: FORK_BLOCK_NUMBER,
    });

    // getting signers with ETH
    [, deployer, randomUser] = await ethers.getSigners();

    // precalculating egg's contract address as both cryptoAnts' contract and Eggs' contract depend on
    // one another
    const currentNonce = await ethers.provider.getTransactionCount(deployer.address);
    eggPrecalculatedAddress = utils.getContractAddress({ from: deployer.address, nonce: currentNonce });

    // deploying contracts
    cryptoAntsFactory = (await ethers.getContractFactory('CryptoAnts')) as CryptoAnts__factory;
    cryptoAnts = await cryptoAntsFactory.deploy(deployer.address, eggPrecalculatedAddress);
    eggFactory = (await ethers.getContractFactory('Egg')) as Egg__factory;
    egg = await eggFactory.connect(deployer).deploy(cryptoAnts.address);

    // snapshot
    snapshotId = await evm.snapshot.take();
  });

  beforeEach(async () => {
    await evm.snapshot.revert(snapshotId);
  });

  it('should only allow to buy eggs paying them', async function () {
    const buyEggWithoutFunds = cryptoAnts.connect(randomUser).buyEggs(1);
    await expect(buyEggWithoutFunds).to.be.revertedWith('You have to pay for those eggs!');

    const overBuyingEggs = cryptoAnts.connect(randomUser).buyEggs(2, { value: ethers.utils.parseEther('0.01') });
    await expect(overBuyingEggs).to.be.revertedWith('You have to pay for those eggs!');
  });

  it('should only allow the CryptoAnts contract to mint eggs', async function () {
    const eggMintByRandomUserTest = egg.connect(randomUser).mint(randomUser.address, 1);
    await expect(eggMintByRandomUserTest).to.be.revertedWith('Only the ants contract can call this function, please refer to the ants contract');

    const beforeEggsBalance = await egg.balanceOf(randomUser.address);
    await cryptoAnts.connect(randomUser).buyEggs(1, { value: ethers.utils.parseEther('0.01') });
    const afterEggsBalance = await egg.balanceOf(randomUser.address);
    expect(afterEggsBalance).to.be.equal(Number(beforeEggsBalance) + 1);
  });

  it('should buy an egg and create a new ant with it', async function () {
    await cryptoAnts.connect(randomUser).buyEggs(1, { value: ethers.utils.parseEther('0.01') });
    const beforeAntsBalance = await cryptoAnts.balanceOf(randomUser.address);
    await cryptoAnts.connect(randomUser).createAnt();
    const afterAntsBalance = await cryptoAnts.balanceOf(randomUser.address);
    expect(afterAntsBalance).to.be.equal(Number(beforeAntsBalance) + 1);
  });

  it('should send funds to the user who sells an ant', async function () {
    await cryptoAnts.connect(randomUser).buyEggs(1, { value: ethers.utils.parseEther('0.01') });
    const createAnt = await cryptoAnts.connect(randomUser).createAnt();
    const { events } = await createAnt.wait();
    let tokenId = 0;
    if (typeof events !== 'undefined' && typeof events[0].args !== 'undefined') {
      tokenId = Number(events[0].args.tokenId);
    }
    expect(tokenId).to.be.equal(1);
    const beforeUserBalance = await randomUser.getBalance();
    await cryptoAnts.connect(randomUser).sellAnt(tokenId);
    const afterUserBalance = await randomUser.getBalance();
    expect(Number(afterUserBalance)).to.be.greaterThan(Number(beforeUserBalance));
  });

  it('should burn the ant after the user sells it', async function () {
    await cryptoAnts.connect(randomUser).buyEggs(1, { value: ethers.utils.parseEther('0.01') });
    const createAnt = await cryptoAnts.connect(randomUser).createAnt();
    const { events } = await createAnt.wait();
    let tokenId = 0;
    if (typeof events !== 'undefined' && typeof events[0].args !== 'undefined') {
      tokenId = Number(events[0].args.tokenId);
    }
    expect(tokenId).to.be.equal(1);
    const beforeAntsBalance = await cryptoAnts.balanceOf(randomUser.address);
    await cryptoAnts.connect(randomUser).sellAnt(tokenId);
    const afterAntsBalance = await cryptoAnts.balanceOf(randomUser.address);
    expect(afterAntsBalance).to.be.equal(Number(beforeAntsBalance) - 1);
  });

  it('should be able to create a 100 ants with only one initial egg', async function () {
    await cryptoAnts.connect(randomUser).buyEggs(1, { value: ethers.utils.parseEther('0.01') });
    const beforeAntsBalance = await cryptoAnts.balanceOf(randomUser.address);
    for (let i = 0; i < 100; i++) {
      await cryptoAnts.connect(randomUser).createAnt();
    }
    const afterAntsBalance = await cryptoAnts.balanceOf(randomUser.address);
    expect(afterAntsBalance).to.be.equal(Number(beforeAntsBalance) + 100);
  });

  it('should be able to create eggs with ants every 10 minutes', async function () {
    await cryptoAnts.connect(randomUser).buyEggs(1, { value: ethers.utils.parseEther('0.01') });
    await cryptoAnts.connect(randomUser).createAnt();
    expect(await cryptoAnts.balanceOf(randomUser.address)).to.be.equal(1);
    await cryptoAnts.connect(randomUser).createEgg(1);
    expect(Number(await egg.balanceOf(randomUser.address))).to.be.greaterThan(1);
    expect(Number(await egg.balanceOf(randomUser.address))).to.be.lessThanOrEqual(21);
    await evm.advanceTimeAndBlock(300);
    await expect(cryptoAnts.connect(randomUser).createEgg(1)).to.be.revertedWith('You have to wait');
    await evm.advanceTimeAndBlock(300);
    await cryptoAnts.connect(randomUser).createEgg(1);
    expect(Number(await egg.balanceOf(randomUser.address))).to.be.lessThanOrEqual(41);
  });

  it('should have a % chance of dying when an ant create eggs', async function () {
    await cryptoAnts.connect(randomUser).buyEggs(1, { value: ethers.utils.parseEther('0.01') });
    await cryptoAnts.connect(randomUser).createAnt();
    expect(await cryptoAnts.balanceOf(randomUser.address)).to.be.equal(1);
    for (let i = 0; i < 1000; i++) {
      await cryptoAnts.connect(randomUser).createEgg(1);
      await evm.advanceTimeAndBlock(600);
      if (Number(await cryptoAnts.balanceOf(randomUser.address)) === 0) {
        break;
      }
    }
    expect(await cryptoAnts.balanceOf(randomUser.address)).to.be.equal(0);
  });

  /*
      This is a completely optional test.
      Hint: you may need advanceTimeAndBlock (from utils) to handle the egg creation cooldown
    */
});
