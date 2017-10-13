/* ============================================================
 * node-binance-api
 * https://github.com/jaggedsoft/node-binance-api
 * ============================================================
 * Copyright 2017-, Jon Eyrick
 * Released under the MIT License
 * ============================================================ */

module.exports = function() {
	'use strict';
	const WebSocket = require('ws');
	const request = require('request');
	const crypto = require('crypto');
	const base = 'https://www.binance.com/api/';
	const websocket_base = 'wss://stream.binance.com:9443/ws/';
	let depthCache = {};
	let options = {};
	
	const publicRequest = function(url, data, callback, method = "GET") {
		if ( !data ) data = {};
		let opt = {
			url: url,
			qs: data,
			method: method,
			agent: false,
			headers: {
				'User-Agent': 'Mozilla/4.0 (compatible; Node Binance API)',
				'Content-type': 'application/x-www-form-urlencoded'
			}
		};
		request(opt, function(error, response, body) {
			if ( !response || !body ) throw "publicRequest error: "+error;
			if ( callback ) callback(JSON.parse(body));
		});
	};
	
	const apiRequest = function(url, callback, method = "GET") {
		let opt = {
			url: url,
			method: method,
			agent: false,
			headers: {
				'User-Agent': 'Mozilla/4.0 (compatible; Node Binance API)',
				'Content-type': 'application/x-www-form-urlencoded',
				'X-MBX-APIKEY': options.APIKEY
			}
		};
		request(opt, function(error, response, body) {
			if ( !response || !body ) throw "apiRequest error: "+error;
			if ( callback ) callback(JSON.parse(body));
		});
	};
		
	const signedRequest = function(url, data, callback, method = "GET") {
		if ( !data ) data = {};
		data.timestamp = new Date().getTime();
		if ( typeof data.symbol !== "undefined" ) data.symbol = data.symbol.replace('_','');
		if ( typeof data.recvWindow == "undefined" ) data.recvWindow = 6500;
		let query = Object.keys(data).reduce(function(a,k){a.push(k+'='+encodeURIComponent(data[k]));return a},[]).join('&');
		let signature = crypto.createHmac("sha256", options.APISECRET).update(query).digest("hex"); // set the HMAC hash header
		let opt = {
			url: url+'?'+query+'&signature='+signature,
			method: method,
			agent: false,
			headers: {
				'User-Agent': 'Mozilla/4.0 (compatible; Node Binance API)',
				'Content-type': 'application/x-www-form-urlencoded',
				'X-MBX-APIKEY': options.APIKEY
			}
		};
		request(opt, function(error, response, body) {
			if ( !response || !body ) throw "signedRequest error: "+error;
			if ( callback ) callback(JSON.parse(body));
		});
	};
	
	const order = function(side, symbol, quantity, price, flags = {}) {
		let opt = {
			symbol: symbol,
			side: side,
			type: "LIMIT",
			price: price,
			quantity: quantity,
			timeInForce: "GTC",
			recvWindow: 60000
		};
		if ( typeof flags.type !== "undefined" ) opt.tye = flags.type;
		if ( typeof flags.icebergQty !== "undefined" ) opt.icebergQty = flags.icebergQty;
		if ( typeof flags.stopPrice !== "undefined" ) opt.stopPrice = flags.stopPrice;
		signedRequest(base+"v3/order", opt, function(response) {
			console.log(side+"("+symbol+","+quantity+","+price+") ",response);
		}, "POST");
	};
	////////////////////////////
	const subscribe = function(endpoint, callback) {
		const ws = new WebSocket(websocket_base+endpoint);
	    ws.on('open', function() {
			//console.log("subscribe("+endpoint+")");
		});
		ws.on('close', function() {
			console.log("WebSocket connection closed");
		});
		
		ws.on('message', function(data) {
			//console.log(data);
            callback(JSON.parse(data));
		});
	};
	const userDataHandler = function(data) {
		let type = data.e;
		if ( type == "outboundAccountInfo" ) {
			options.balance_callback(data);
		} else if ( type == "executionReport" ) {
			options.execution_callback(data);
		} else {
			console.log("Unexpected data: "+type);
		}
	};
	////////////////////////////
	const priceData = function(data) {
		let prices = {};
		for ( let obj of data ) {
			prices[obj.symbol] = obj.price;
		}
		return prices;
	};
	const bookPriceData = function(data) {
		let prices = {};
		for ( let obj of data ) {
			prices[obj.symbol] = {
				bid:obj.bidPrice,
				bids:obj.bidQty,
				ask:obj.askPrice,
				asks:obj.askQty
			};
		}
		return prices;
	};
	const balanceData = function(data) {
		let balances = {};
		for ( let obj of data.balances ) {
			balances[obj.asset] = {available:obj.free, onOrder:obj.locked};
		}
		return balances;
	};
	const depthData = function(data) {
		let bids = {}, asks = {}, obj;
		for ( obj of data.bids ) {
			bids[obj[0]] = obj[1];
		}
		for ( obj of data.asks ) {
			asks[obj[0]] = obj[1];
		}
		return {bids:bids, asks:asks};
	}
	const getDepthCache = function(symbol) {
		if ( typeof depthCache[symbol] == "undefined" ) return {bids: {}, asks: {}};
		return depthCache[symbol];
	};
	////////////////////////////
	return {
		depthCache: function(symbol) {
			return getDepthCache(symbol);
		},
		sortBids: function(symbol) {
			let object = {}, cache;
			if ( typeof symbol == "object" ) cache = symbol;
			else cache = getDepthCache(symbol).bids;
			let sorted = Object.keys(cache).sort(function(a, b){return parseFloat(b)-parseFloat(a)});
			for ( let price of sorted ) {
				object[price] = cache[price];
			}
			return object;
		},
		sortAsks: function(symbol) {
			let object = {}, cache;
			if ( typeof symbol == "object" ) cache = symbol;
			else cache = getDepthCache(symbol).asks;
			let sorted = Object.keys(cache).sort(function(a, b){return parseFloat(a)-parseFloat(b)});
			for ( let price of sorted ) {
				object[price] = cache[price];
			}
			return object;
		},
		first: function(object) {
			return Object.keys(object)[0];
		},
		options: function(opt) {
			options = opt;
		},
		buy: function(symbol, quantity, price, flags = {}) {
			order("BUY", symbol, quantity, price, flags);
		},
		sell: function(symbol, quantity, price, flags = {}) {
			order("SELL", symbol, quantity, price, flags);
		},
		cancel: function(symbol, orderid, callback) {
			signedRequest(base+"v3/order", {symbol:symbol, orderId:orderid}, callback, "DELETE");
		},
		orderStatus: function(symbol, orderid, callback) {
			signedRequest(base+"v3/order", {symbol:symbol, orderId:orderid}, callback);
		},
		openOrders: function(symbol, callback) {
			signedRequest(base+"v3/openOrders", {symbol:symbol}, callback);
		},
		allOrders: function(symbol, callback) {
			signedRequest(base+"v3/allOrders", {symbol:symbol, limit:500}, callback);
		},
		depth: function(symbol, callback) {
			publicRequest(base+"v1/depth", {symbol:symbol}, function(data) {
				return callback(depthData(data));
			});
		},
		prices: function(callback) {
			request(base+"v1/ticker/allPrices", function(error, response, body) {
				if ( !response || !body ) throw "allPrices error: "+error;
				if ( callback ) callback(priceData(JSON.parse(body)));
			});
		},
		bookTickers: function(callback) {
			request(base+"v1/ticker/allBookTickers", function(error, response, body) {
				if ( !response || !body ) throw "allBookTickers error: "+error;
				if ( callback ) callback(bookPriceData(JSON.parse(body)));
			});
		},
		prevDay: function(symbol, callback) {
			publicRequest(base+"v1/ticker/24hr", {symbol:symbol}, callback);
		},
		account: function(callback) {
			signedRequest(base+"v3/account", {}, callback);
		},
		balance: function(callback) {
			signedRequest(base+"v3/account", {}, function(data) {
				if ( callback ) callback(balanceData(data));
			});
		},
		trades: function(symbol,callback) {
			signedRequest(base+"v3/myTrades", {symbol:symbol}, callback);
		},
		candlesticks: function(symbol, interval = "5m", callback) { //1m,3m,5m,15m,30m,1h,2h,4h,6h,8h,12h,1d,3d,1w,1M
			publicRequest(base+"v1/klines", {symbol:symbol, interval:interval}, callback);
		},
		publicRequest: function(url, data, callback, method = "GET") {
			publicRequest(url, data, callback, method)
		},
		signedRequest: function(url, data, callback, method = "GET") {
			signedRequest(url, data, callback, method);
		},
		websockets: {
			userData: function(callback, execution_callback = null) {
				apiRequest(base+"v1/userDataStream", function(response) {
					options.listenKey = response.listenKey;
					setInterval(function() { // keepalive
						apiRequest(base+"v1/userDataStream", false, "PUT");
					},30000);
					if ( typeof execution_callback == "function" ) {
						options.balance_callback = callback;
						options.execution_callback = execution_callback;
						subscribe(options.listenKey, userDataHandler);
						return;
					}
					subscribe(options.listenKey, callback);
				},"POST");
			},
			subscribe: function(url, callback) {
				subscribe(url, callback);
			},
			depth: function(symbols, callback) {
				for ( let symbol of symbols ) {
					subscribe(symbol.toLowerCase()+"@depth", callback);
				}
			},
			depthCache: function(symbols, callback) {
				for ( let symbol of symbols ) {
					depthCache[symbol] = {bids: {}, asks: {}};
					publicRequest(base+"v1/depth", {symbol:symbol}, function(json) {
						depthCache[symbol] = depthData(json);
						if ( callback ) callback(symbol, depthCache[symbol]);
						subscribe(symbol.toLowerCase()+"@depth", function(depth) {
							let obj;
							for ( obj of depth.b ) { //bids
								depthCache[symbol].bids[obj[0]] = obj[1];
								if ( obj[1] == '0.00000000' ) {
									delete depthCache[symbol].bids[obj[0]];
								}
							}
							for ( obj of depth.a ) { //asks
								depthCache[symbol].asks[obj[0]] = obj[1];
								if ( obj[1] == '0.00000000' ) {
									delete depthCache[symbol].asks[obj[0]];
								}
							}
							if ( callback ) callback(symbol, depthCache[symbol]);
						});
					});
				}
			},
			trades: function(symbols, callback) {
				for ( let symbol of symbols ) {
					subscribe(symbol.toLowerCase()+"@aggTrade", callback);
				}
			},
			candlesticks: function(symbols, interval, callback) {
				for ( let symbol of symbols ) {
					subscribe(symbol.toLowerCase()+"@kline_"+interval, callback);
				}
			}
		}
	};
}();
