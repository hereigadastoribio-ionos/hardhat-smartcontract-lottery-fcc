const { assert, expect } = require('chai');
const { network, getNamedAccounts, deployments, ethers } = require('hardhat');
const {
	developmentChains,
	networkConfig,
} = require('../../helper-hardhat-config');

!developmentChains.includes(network.name)
	? describe.skip
	: describe('Raffle Unit Tests', () => {
			let raffle,
				vrfCoordinatorV2Mock,
				raffleEntranceFee,
				deployer,
				interval,
				raffleState;
			const chainId = network.config.chainId;

			beforeEach(async () => {
				deployer = (await getNamedAccounts()).deployer;
				await deployments.fixture(['all']);
				raffle = await ethers.getContract('Raffle', deployer);
				vrfCoordinatorV2Mock = await ethers.getContract(
					'VRFCoordinatorV2Mock',
					deployer
				);
				raffleEntranceFee = await raffle.getEntranceFee();
				interval = await raffle.getInterval();
			});

			describe('constructor', () => {
				it('Initializes the raffle correctly', async () => {
					raffleState = await raffle.getRaffleState();
					assert.equal(raffleState.toString(), '0');
					assert.equal(
						interval.toString(),
						networkConfig[chainId]['interval']
					);
				});
			});

			describe('enterRaffle', () => {
				it("Reverts when you don't pay enough", async () => {
					await expect(raffle.enterRaffle()).to.be.revertedWith(
						'Raffle__NotEnoughETHEntered'
					);
				});

				it('Records players when they enter', async () => {
					await raffle.enterRaffle({ value: raffleEntranceFee });
					const playerFromContract = await raffle.getPlayer(0);
					assert.equal(playerFromContract, deployer);
				});

				it('Emits event on enter', async () => {
					await expect(
						raffle.enterRaffle({ value: raffleEntranceFee })
					).to.emit(raffle, 'RaffleEnter');
				});

				it("Doesn't allow entrance when raffle is calculating", async () => {
					await raffle.enterRaffle({ value: raffleEntranceFee });
					await network.provider.send('evm_increaseTime', [
						interval.toNumber() + 1,
					]);
					await network.provider.send('evm_mine', []);
					await raffle.performUpkeep([]);
					await expect(
						raffle.enterRaffle({ value: raffleEntranceFee })
					).to.be.revertedWith('Raffle__NotOpen');
				});
			});

			describe('checkUpkeep', () => {
				it("Returns false if people haven't sent any ETH", async () => {
					await network.provider.send('evm_increaseTime', [
						interval.toNumber() + 1,
					]);
					await network.provider.send('evm_mine', []);
					const { upkeepNeeded } =
						await raffle.callStatic.checkUpkeep([]);
					assert(!upkeepNeeded);
				});

				it("Returns false if raffle isn't open", async () => {
					await raffle.enterRaffle({ value: raffleEntranceFee });
					await network.provider.send('evm_increaseTime', [
						interval.toNumber() + 1,
					]);
					await network.provider.send('evm_mine', []);
					await raffle.performUpkeep([]);
					const raffleState = await raffle.getRaffleState();
					const { upkeepNeeded } =
						await raffle.callStatic.checkUpkeep([]);
					assert.equal(raffleState.toString(), '1');
					assert.equal(upkeepNeeded, false);
				});

				it("returns false if enough time hasn't passed", async () => {
					await raffle.enterRaffle({ value: raffleEntranceFee });
					await network.provider.send('evm_increaseTime', [
						interval.toNumber() - 5,
					]); // use a higher number here if this test fails
					await network.provider.request({
						method: 'evm_mine',
						params: [],
					});
					const { upkeepNeeded } =
						await raffle.callStatic.checkUpkeep('0x'); // upkeepNeeded = (timePassed && isOpen && hasBalance && hasPlayers)
					assert(!upkeepNeeded);
				});

				it('returns true if enough time has passed, has players, eth, and is open', async () => {
					await raffle.enterRaffle({ value: raffleEntranceFee });
					await network.provider.send('evm_increaseTime', [
						interval.toNumber() + 1,
					]);
					await network.provider.request({
						method: 'evm_mine',
						params: [],
					});
					const { upkeepNeeded } =
						await raffle.callStatic.checkUpkeep('0x'); // upkeepNeeded = (timePassed && isOpen && hasBalance && hasPlayers)
					assert(upkeepNeeded);
				});
			});

			describe('performUpkeep', () => {
				it('It can only run if checkUpkeep is true', async () => {
					await raffle.enterRaffle({ value: raffleEntranceFee });
					await network.provider.send('evm_increaseTime', [
						interval.toNumber() + 1,
					]);
					await network.provider.send('evm_mine', []);
					const tx = await raffle.performUpkeep([]);
					assert(tx);
				});

				it('Reverts when checkUpkeep is false', async () => {
					await expect(raffle.performUpkeep([])).to.be.revertedWith(
						'Raffle__UpkeepNotNeeded'
					);
				});

				it('Updates the raffle state, emits an event and calls the vrf coordinator', async () => {
					await raffle.enterRaffle({ value: raffleEntranceFee });
					await network.provider.send('evm_increaseTime', [
						interval.toNumber() + 1,
					]);
					await network.provider.send('evm_mine');
					const txResponse = await raffle.performUpkeep([]);
					const txReceipt = await txResponse.wait(1);
					const requestId = txReceipt.events[1].args.requestId;
					raffleState = await raffle.getRaffleState();
					assert(requestId.toNumber() > 0);
					assert(raffleState.toString() == '1');
				});
			});

			describe('fulfillRandomWords', () => {
				beforeEach(async () => {
					await raffle.enterRaffle({ value: raffleEntranceFee });
					await network.provider.send('evm_increaseTime', [
						interval.toNumber() + 1,
					]);
					await network.provider.send('evm_mine', []);
				});

				it('Can only be called after performUpkeep', async () => {
					await expect(
						vrfCoordinatorV2Mock.fulfillRandomWords(
							0,
							raffle.address
						)
					).to.be.revertedWith('nonexistent request');

					await expect(
						vrfCoordinatorV2Mock.fulfillRandomWords(
							1,
							raffle.address
						)
					).to.be.revertedWith('nonexistent request');
				});

				it('Picks a winner, resets the lottery and sends money', async () => {
					const additionalEntrants = 3;
					const startingAccountIndex = 1;
					const accounts = await ethers.getSigners();

					for (
						let i = startingAccountIndex;
						i < startingAccountIndex + additionalEntrants;
						i++
					) {
						const accountConnectedRaffle = raffle.connect(
							accounts[i]
						);
						await accountConnectedRaffle.enterRaffle({
							value: raffleEntranceFee,
						});
					}
					const startingTimestamp = await raffle.getLastTimestamp();
					const winnerStartingBalance =
						await accounts[1].getBalance();

					await new Promise(async (resolve, reject) => {
						raffle.once('WinnerPicked', async () => {
							console.log('Found the event!');
							try {
								const recentWinner =
									await raffle.getRecentWinner();
								const raffleState =
									await raffle.getRaffleState();
								const endingTimestamp =
									await raffle.getLastTimestamp();
								const numPlayers =
									await raffle.getNumberOfPlayers();
								const winnerEndingBalance =
									await accounts[1].getBalance();
								console.log(recentWinner);
								console.log(
									'------------------------------------------'
								);
								console.log(accounts[0].address);
								console.log(accounts[1].address);
								console.log(accounts[2].address);
								console.log(accounts[3].address);
								console.log(
									'------------------------------------------'
								);

								assert.equal(numPlayers.toString(), '0');
								assert.equal(raffleState.toString(), '0');
								assert(endingTimestamp > startingTimestamp);
								assert.equal(
									winnerEndingBalance.toString(),
									winnerStartingBalance
										.add(
											raffleEntranceFee
												.mul(additionalEntrants)
												.add(raffleEntranceFee)
										)
										.toString()
								);
							} catch (error) {
								console.error(error);
								reject(error);
							}
							resolve();
						});
						const tx = await raffle.performUpkeep([]);
						const txReceipt = await tx.wait(1);
						await vrfCoordinatorV2Mock.fulfillRandomWords(
							txReceipt.events[1].args.requestId,
							raffle.address
						);
					});
				});
			});
	  });
