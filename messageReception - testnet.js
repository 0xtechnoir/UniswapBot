// Testnet version

import { DiscordRequest } from "./utils.js";
import { ethers } from "ethers";
import 'dotenv/config'

// Define global constants 

const addresses = {
  WETH: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',
  testWETH: '0xc778417E063141139Fce010982780140Aa0cD5Ab',
  router: '0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D', // uniswapV2 router
}

// WETH - SOLACE V3Pool - https://www.dextools.io/app/ether/pair-explorer/0x29998355C51F2eddff0B12a183B8BDD590EDaed1

// To switch between testnet and mainnet, change:
// priceCheckInterval
// swap WETH and testWETH
// provider
// private key in .env
// while loop logic with count variable

const ETH_AMOUNT = '0.1'
const gasPriceLimit = 125000000000 // 125 gwei
const priceCheckInterval = 1000 * 5 // 5 seconds
const PK = process.env['TESTNET_PRIVATE_KEY']
const PROJECT_ID = process.env['PROJECT_ID']
const rinkebyURL = 'https://rinkeby.infura.io/v3/'
const ropstenURL = 'https://ropsten.infura.io/v3/'
const mainNetURL = 'https://mainnet.infura.io/v3/'
const provider = new ethers.providers.JsonRpcProvider(ropstenURL + PROJECT_ID);
const wallet = new ethers.Wallet(PK, provider);
const walletAddress = wallet.address;
const account = wallet.connect(provider)
const swapEventHash = '0xd78ad95fa46c994b6551d0da85fc275fe613ce37657fb8d5e3d130840159d822'

const router = new ethers.Contract(
  addresses.router,
  [
    'function getAmountsOut(uint amountIn, address[] memory path) public view returns (uint[] memory amounts)',
    'function swapExactETHForTokens(uint amountOutMin, address[] calldata path, address to, uint deadline) external payable returns (uint[] memory amounts)',
    'function swapExactTokensForETH(uint amountIn, uint amountOutMin, address[] calldata path, address to, uint deadline) external returns (uint[] memory amounts)',
    'function swapExactTokensForETHSupportingFeeOnTransferTokens(uint amountIn, uint amountOutMin, address[] calldata path, address to, uint deadline) external'
  ],
  account
); 

// Define global variables

let pairAddress, pair, tokenPurchasePriceInEth, ethSpent, tokensRecieved, tokenIn, tokenOut, authToken

export async function handleMessageReception(message, _token) {

  authToken = _token
  const dexLink = message.match(
      "(https://www.dextools.io/app/ether/pair-explorer/0x[a-fA-F0-9]{1,})"
  );

  if (dexLink) {
      console.log(`dexLink: ${dexLink[1]}`)
      buy(dexLink[1])
  }
}

async function buy(url) {

  console.log("=========== Buying Token ===========")
  pairAddress = extractPairAddress(url)
  console.log(`pair address: ${pairAddress}`)

  // Define the Uniswap pair contract object
 pair = new ethers.Contract(
    pairAddress,
    [
      'function token0() external view returns (address)',
      'function token1() external view returns (address)',
      'function approve(address spender, uint value) external returns (bool)'
    ],
    account
  )
  
  const token0 = await pair.token0()
  const token1 = await pair.token1()

  if(token0 === addresses.testWETH) {
    tokenIn = token0;
    tokenOut = token1;
  }
  
  if(token1 === addresses.testWETH) {
    tokenIn = token1;
    tokenOut = token0;
  }
  
  if(tokenIn != addresses.testWETH) {
    console.log("exit - Needs to be a WETH pair")
    return;
  }
  
  const amountIn = ethers.utils.parseUnits(ETH_AMOUNT, 'ether');
  
  // calculate all subsequent maximum output token amounts by calling getReserves for each pair of token addresses in the path in turn, and using these to call getAmountOut.
  let amounts
  try {
    amounts = await router.getAmountsOut(amountIn, [tokenIn, tokenOut]);
  } catch (err) {
    console.log(`Error occurred during router.getAmountsOut`)
    console.log(`Error is: ${err}`)
  }
  const amountOutMin = calculateSlippage(amounts[1], 22)
  console.log(`Min amount of tokens: ${amountOutMin*10e-19}`)
 
  try{
    const currentGasPrice = await provider.getGasPrice()
    const txGasPrice = currentGasPrice.add(50000000000) // increase by 50 gwei
    
    console.log(`Current gas price: ${ethers.utils.formatUnits(currentGasPrice, "gwei")}`)
    console.log(`Gas cost for txn (current gas price + 50 gwei): ${ethers.utils.formatUnits(txGasPrice, "gwei")}`)

    if (txGasPrice < gasPriceLimit) {
      
      const options = { gasPrice: txGasPrice, gasLimit: 500000, value: amountIn };    
      
      const tx = await router.swapExactETHForTokens(
        amountOutMin,
        [tokenIn, tokenOut],
        walletAddress,
        Date.now() + 1000 * 60 * 10, // 10 minute deadline after which tx reverts if not completed
        options
      )
  
      console.log(`Buy transaction submitted with hash: ${tx.hash}`)

      const receipt = await tx.wait();  

      if(receipt) {
        console.log(`Buy transaction successful`)

        const logs = receipt.logs
        let swapData

        // loop through the logs and find the swap event
        for(let i = 0; i < logs.length ; i++) {
          const topic = logs[i]["topics"]
          if(topic[0] == swapEventHash) {
            swapData = ethers.utils.defaultAbiCoder.decode(
              ['uint256', 'uint256', 'uint256', 'uint256'], logs[i]["data"]
            )
          } 
        }
               
        console.log("swapData: " + swapData)

        // swap data contains 4 indexes [amount0In, amount1In, amount0Out, amount1Out]
        // we want to find which of the inputs have values
        ethSpent = (swapData[0] == 0) ? swapData[1] : swapData[0]
        tokensRecieved = (swapData[2] == 0) ? swapData[3] : swapData[2]

        console.log(`Eth Spent: ${ethSpent*10e-19}`) 
        console.log(`Tokens Recieved: ${tokensRecieved*10e-19}`)
        await watchPrice()
      }
      
    } else {
      console.log("Specified gas price limit exceeded")
    }
    
  } catch(err) {
    console.log(`Error occurred during outer.swapExactETHForTokens`)
    console.log(`Error is: ${err}`)
  }
}

async function watchPrice() {

  console.log("Monitoring token price...")
  // we want to query the token price periodically until we sell the token

  // switch tokens around for selling operation
  const sellTokenOut = tokenIn // WETH
  const sellTokenIn = tokenOut // Other token
  let previousEthAmountOut = ethSpent
  let ethAmountOut = ethSpent

  const stoploss = 85 // %

  // For testing purposes - When the AMM is on testnet token prices do not move much 
  // therefore we will execute the loop 5 times before calling the sell function
  let count = 0

  while (true) {

    console.log("=========== Checking Token Price ===========")
    console.log(`Time: ${new Date()}`)
    console.log(`Stop loss set at: ${(previousEthAmountOut.div(100).mul(stoploss))*10e-19} (${stoploss}% of previousEthAmountOut)`)
    
    // we use the tokenRecieved created in buy() function to set the amountIn
    // Quote comes back in WETH
    console.log("tokensRecieved: " + tokensRecieved)
    const amountOut = await router.getAmountsOut(tokensRecieved, [sellTokenIn, sellTokenOut]);
    ethAmountOut = amountOut[1]

    console.log(`If we were to sell now we would get back ${ethAmountOut*10e-19} ETH`)

    // if the token price has increased we need to move our trailing stop loss
    if (ethAmountOut > previousEthAmountOut) {
      previousEthAmountOut = ethAmountOut
      console.log(`Token value has increased. Moving trailing stop loss up to ${(previousEthAmountOut.div(100).mul(stoploss))*10e-19} ETH`)
    } 

    // if the token price has dropped beneath our stop loss we need to initiate a sell
    if (ethAmountOut < previousEthAmountOut.div(100).mul(stoploss)) {
      const amountOutMin = calculateSlippage(ethAmountOut, 22)
      console.log(`Trailing stop loss has been triggered, initiating sell for a minimum of ${amountOutMin*10e-19} ETH`)
      sell(amountOutMin, sellTokenIn, sellTokenOut) // sellTokenIn = token, sellTokenOut = WETH
      return
    }
    
    if(count == 5) {
      const amountOutMin = calculateSlippage(ethAmountOut, 22)
      console.log(`Trailing stop loss has been triggered, initiating sell for a minimum of ${amountOutMin*10e-19} ETH`)
      sell(amountOutMin, sellTokenIn, sellTokenOut) // sellTokenIn = token, sellTokenOut = WETH
      return
    }
    count++

    await delay(priceCheckInterval)
  } // end of while loop 
}

async function sell(amountOutMin, sellTokenIn, sellTokenOut) {

  console.log("=========== Selling Token ===========")
  console.log(`Selling token at address: ${sellTokenIn}`)
  console.log(`For at least ${amountOutMin*10e-19} tokens at address: ${sellTokenOut}`)

  // Define the token contract object
  const tokenContract = new ethers.Contract(
    sellTokenIn,
    ['function approve(address spender, uint256 amount) external returns (bool)'],
    account
  ); 

  try{
    console.log(`Approving uniswap router contract to transfer: ${JSON.stringify(tokensRecieved*10e-19)} tokens`)
    // we need to give the router contract approval to move the token on our behalf. 
    const approve_tx = await tokenContract.approve(addresses.router, tokensRecieved)
    console.log(`Approve Tx Result: ${JSON.stringify(approve_tx)}`)

    // calcaulate the gas price we want to use
    const currentGasPrice = await provider.getGasPrice()
    const txGasPrice = currentGasPrice.add(50000000000) // increase by 50 gwei
    console.log(`Current gas price: ${ethers.utils.formatUnits(currentGasPrice, "gwei")}`)
    console.log(`Gas cost for txn (current gas price + 50 gwei): ${ethers.utils.formatUnits(txGasPrice, "gwei")}`)

    // if the calcaulated gas price is less than the gas limit we set
    if (txGasPrice < gasPriceLimit) {
      
      const options = { gasPrice: txGasPrice, gasLimit: 500000 };    
      const tx = await router.swapExactTokensForETH(
        tokensRecieved, // amountIn - the number of tokens we bought earlier 
        amountOutMin,
        [sellTokenIn, sellTokenOut], // sellTokenIn = token, sellTokenOut = WETH
        walletAddress,
        Date.now() + 1000 * 60 * 10, // 10 minute deadline
        options
      )
  
      console.log(`Sell transaction submitted with hash: ${tx.hash}`)
      
      const receipt = await tx.wait();
      if(receipt) {
        console.log(`Sell transaction successful`)

        const logs = receipt.logs
        let swapData

        // loop through the logs and find the swap event
        for(let i = 0; i < logs.length ; i++) {
          const topic = logs[i]["topics"]
          if(topic[0] == swapEventHash) {
            swapData = ethers.utils.defaultAbiCoder.decode(
              ['uint256', 'uint256', 'uint256', 'uint256'], logs[i]["data"]
            )
          } 
        }
               
        // swap data contains 4 indexes [amount0In, amount1In, amount0Out, amount1Out]
        // we want to find which of the inputs have values
        const ethRecieved = (swapData[2] == 0) ? swapData[3] : swapData[2]
        
        console.log(`You opened your trade with ${ETH_AMOUNT} ETH`)
        console.log(`You closed your trade with ${ethRecieved*10e-19} ETH`)
        console.log("=========== Trade Complete ===========")
      }  
    } else {
      console.log("Specified gas price limit exceeded")
    }
  } catch(err) {
    console.log(`Error occurred during outer.swapExactETHForTokens`)
    console.log(`Error is: ${err}`)
  } 
}

// Utility Functions

function extractPairAddress(url) {
  let re = /[0]/;
  let startIndex = url.search(re);
  return url.substring(startIndex, startIndex+42)
}

function delay(delayInms) {
  return new Promise(resolve => {
    setTimeout(() => {
      resolve(2);
    }, delayInms);
  });
}

function calculateSlippage(quotedAmount, slippageAmount) {
  console.log(`Quoted amount: ${quotedAmount*10e-19}`)
  console.log(`slippage amount: ${slippageAmount} %`)
  const tokenDiff = (quotedAmount.div(100)).mul(slippageAmount)
  return quotedAmount.sub(tokenDiff);
}






