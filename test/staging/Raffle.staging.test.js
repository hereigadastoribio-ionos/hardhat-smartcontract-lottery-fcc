const { assert, expect } = require('chai');
const { network, getNamedAccounts, deployments, ethers } = require('hardhat');
const {
	developmentChains,
	networkConfig,
} = require('../../helper-hardhat-config');

developmentChains.includes(network.name)
	? describe.skip
	: describe('Raffle Unit Tests', () => {
			let raffle, raffleEntranceFee, deployer, raffleState;

			beforeEach(async () => {
				deployer = (await getNamedAccounts()).deployer;
				raffle = await ethers.getContract('Raffle', deployer);
				raffleEntranceFee = await raffle.getEntranceFee();
			});

			describe('fulfillRandomWords', () => {
				it('Works with live Chainlink Keepers and Chainlink VRF, we get a random winner', async () => {
					console.log('Setting up test...');
					const startingTimestamp = await raffle.getLastTimestamp();
					const accounts = await ethers.getSigners();

					console.log('Setting up Listener...');
					await new Promise(async (resolve, reject) => {
						raffle.once('WinnerPicked', async () => {
							console.log('Winner picked event fired');
							try {
								const recentWinner =
									await raffle.getRecentWinner();
								const raffleState =
									await raffle.getRaffleState();
								const winnerEndingBalance =
									await accounts[0].getBalance();
								const endingTimestamp =
									await raffle.getLastTimestamp();

								await expect(raffle.getPlayer(0)).to.be
									.reverted;
								assert.equal(
									recentWinner.toString(),
									accounts[0].address
								);
								assert.equal(raffleState, 0);
								assert.equal(
									winnerEndingBalance.toString(),
									winnerStartingBalance
										.add(raffleEntranceFee)
										.toString()
								);
								assert(endingTimestamp > startingTimestamp);
							} catch (error) {
								console.error(error);
								reject(error);
							}
							resolve();
						});

						console.log('Entering Raffle...');
						await raffle.enterRaffle({ value: raffleEntranceFee });
						const winnerStartingBalance =
							await accounts[0].getBalance();
						await tx.wait(1);
						console.log('Ok, time to wait...');
					});
				});
			});
	  });
