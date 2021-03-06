define(['./alasqlportfoliodata', './bankdataportfolio', './alasqlstockdata', './alasqlcurrencydata', './alasqllocalization'], 
    function(alasqlportfoliodata, bankdataportfolio, alasqlstockdata, alasqlcurrencydata, alasqllocalization) {

    var spreadSheetData = [];
    var spreadSheetId;
    var yqlUrl = 'https://query.yahooapis.com/v1/public/yql';
    var historicalUrl = 'http://finance.yahoo.com/d/quotes.csv';
    var currencyArray = [];
    var mergedCellsArray = [];
    var filterCells;
    var stockLastTradePriceArray = [];
    var skipRunningFunctions = false;
    var columnBransch = 2;
    var localStorageStocksBranschField = "spreadsheetstocksarray_bransch_ver1";

    kendo.spreadsheet.defineFunction("YFCURRENCYTOUSERCURRENCY", function(callback, currency){
        fetchCurrencyToUserCurrency(currency, function(value){
            callback(value);
        });
    }).argsAsync([
        [ "currency", "string" ]
    ]);

    function fetchCurrencyToUserCurrency(currency, callback) {

        if(skipRunningFunctions) return;
        var userCurrency = alasqllocalization.getUserCurrency();
        if(currency === userCurrency) { callback(1); return; };
        if(currencyArray[currency] != null) { callback(currencyArray[currency]); return; };

        var currencyValue = alasqlcurrencydata.getCurrencyExchangeRateValue(currency);
        currencyArray[currency] = currencyValue;
        callback(currencyValue);
    }

    kendo.spreadsheet.defineFunction("yflastprice", function(callback, symbol){
        fetchLastTradePriceOnly(symbol, 0, function(value){
            callback(value);
        });
    }).argsAsync([
        [ "symbol", "string" ]
    ]);

    function fetchLastTradePriceOnly(symbol, retryNumber, callback) {

        if(skipRunningFunctions) return;

        var queryTemplate = _.template("select * from csv where url='" + historicalUrl + "?s=<%= symbol %>&f=l1' and columns='LastTradePriceOnly'");

        $.ajax({
            url: yqlUrl,
            data: {q: queryTemplate({symbol:symbol}), format: 'json'},
            timeout: 10000
        }).done(function(output) {
            var response = _.isString(output) ? JSON.parse(output) : output;
            var results = response.query.results;
            if(results == null) {
                if(stockLastTradePriceArray[symbol]) { callback(stockLastTradePriceArray[symbol]); return; };

                if(retryNumber < 4){
                    retryNumber++;
                    setTimeout(function(){ fetchLastTradePriceOnly(symbol, retryNumber, callback); }, 50);
                    return;
                }

                callback(0); 
                return;
            }

            var lastTradePriceOnly = results.row.LastTradePriceOnly;
            if(lastTradePriceOnly === "N/A") {
                var link = "https://www.avanza.se" + alasqlstockdata.getAzaLinkFromYahooSymbol(symbol);
                var queryYqlAvanzaTemplate = _.template("select * from html where url='<%= link %>' and xpath='//span[@class=\"lastPrice SText bold\"]//span[@class=\"pushBox roundCorners3\"]/text()'");
                
                $.ajax({
                    url: yqlUrl,
                    async: true,
                    data: {q: queryYqlAvanzaTemplate({link:link}), format: 'json'},
                    timeout: 10000
                }).done(function(output) {
                    if(output == null) { callback(0); return; };
                    var yqlAvanzaResponse = _.isString(output) ? JSON.parse(output) : output;
                    if(yqlAvanzaResponse.query.count === 0) { callback(0); return; };
                    var resultValue = parseFloat(yqlAvanzaResponse.query.results.replace(",", ".")).toFixed(2);

                    stockLastTradePriceArray[symbol] = resultValue;
                    lastTradePriceOnly = resultValue;
                    callback(resultValue);
                    return;

                }).fail(function(err) {
                    console.log(err.responseText);
                    callback(0);
                    return;
                }); 
            } else {

                stockLastTradePriceArray[symbol] = lastTradePriceOnly;
                callback(lastTradePriceOnly);
            }

        }).fail(function(err) {
            console.log(err.responseText);
            callback(0);
        }); 
    }

    function setSpreadsheetId(fieldId) {
        spreadSheetId = fieldId;
    }

    function resetArrayValues() {
        spreadSheetData = [];
        mergedCellsArray = [];
        stockLastTradePrice = [];
    }

    function setData() {

        var portfolioData = bankdataportfolio.getStocksInPortfolio();

        resetArrayValues();

        spreadSheetData.push({
            height: 25,
            cells: [
                {
                    value: "Värdepapper", textAlign: "center", bold: "true"
                },
                {
                    value: "ISIN", textAlign: "center", bold: "true"
                },
                {
                    value: "Bransch", textAlign: "center", bold: "true"
                },
                {
                    value: "Antal", textAlign: "center", bold: "true"
                },
                {
                    value: "Senaste pris", textAlign: "center", bold: "true"
                },
                {
                    value: "Valuta", textAlign: "center", bold: "true"
                },
                {
                    value: "Marknadsvärde", textAlign: "center", bold: "true"
                }
            ]
        });        
        
        var rowCount = 2;
        var indexCount = 1;
        var storedStocksBranschArray = getStoredBranschArray();
        portfolioData.forEach(function(object) {

            var lastpriceFormula = "=YFLASTPRICE(\"#symbol#\")*YFCURRENCYTOUSERCURRENCY(\"#FX#\")".replace("#symbol#", object.YahooSymbol).replace("#FX#", object.Valuta);
            var marketValueFormula = "D#rowCount#*E#rowPrice#".replace("#rowCount#", rowCount).replace("#rowPrice#", rowCount);
            var bransch = object.Bransch;
            var savedBransch = alasql('SELECT VALUE Bransch FROM ? WHERE ISIN = ?', [storedStocksBranschArray, object.ISIN]);
            if(savedBransch != null)
                bransch = savedBransch;

            spreadSheetData.push({
                index: indexCount,
                cells: [
                    {
                        value: object.Värdepapper, textAlign: "left"
                    },
                    {
                        value: object.ISIN, textAlign: "left"
                    },
                    {
                        value: bransch, textAlign: "left", 
                        validation: {
                             dataType: "list",
                             showButton: true,
                             comparerType: "list",
                             from: '{ "Dagligvaror", "Finans & Fastighet", "Hälsovård",  "Övrigt", "ETF", "Investmentbolag", "Industrivaror & tjänster", "Informationsteknik", "Energi", "Kraftförsörjning", "Sällanköpsvaror- och tjänster" }',
                             allowNulls: true
                         }
                    },
                    {
                        value: object.Antal, format: "#,0"
                    },
                    {
                        formula: lastpriceFormula, textAlign: "right", format: "#,0.00 kr"
                    },
                    {
                        value: object.Valuta, textAlign: "right"
                    },
                    {
                        formula: marketValueFormula, format: "#,0.00 kr"
                    }
                ]
            });

            rowCount++;
            indexCount++;
        });

        var totalSumMarketValueFormula = "SUM(G2:G#LASTROW#)".replace("#LASTROW#", indexCount);
        spreadSheetData.push({
            index: indexCount,
            cells: [
                {
                    index: 0
                },                
                {
                    index: 1
                },
                {
                    index: 2
                },
                {
                    index: 3
                },
                {
                    index: 4, value: "Totalt:", textAlign: "right", bold: "true"
                },
                {
                    index: 5
                },
                {
                    formula: totalSumMarketValueFormula, format: "#,0.00 kr"
                }
            ]
        });

        // Merge cells, to show totaltext
        mergedCellsArray.push(("E#ROW#:F#ROW#").replace("#ROW#", rowCount).replace("#ROW#", rowCount));
        filterCells = "A1:G#ROW#".replace("#ROW#", indexCount);
    }

    function getStoredBranschArray() {
        var data = JSON.parse(localStorage.getItem(localStorageStocksBranschField));
        if(data == null) return [];
        return data;
    }

    function loadSpreadSheet() {

        if($(spreadSheetId).data('kendoSpreadsheet')) {
            $(spreadSheetId).data('kendoSpreadsheet').destroy();
            $(spreadSheetId).empty();
        }

        setTimeout(function(){  
            $(spreadSheetId).kendoSpreadsheet({
                theme: "bootstrap",
                change: onChange,
                toolbar: {
                    home: [ ["cut", "copy", "paste"] ], 
                    insert: [[ "addRowBelow", "addRowAbove" ]], 
                    data: false 
                },
                sheets: [
                    {
                        name: "Värdepapper",
                        mergedCells: mergedCellsArray,
                        filter: {
                            ref: filterCells,
                            columns:[]
                        },
                        rows: spreadSheetData,
                        columns: [
                            {
                                width: 200
                            },
                            {
                                width: 100
                            },
                            {
                                width: 130
                            },
                            {
                                width: 90
                            },
                            {
                                width: 100
                            },
                            {
                                width: 60
                            },
                            {
                                width: 110
                            }
                        ]
                    }
                ],
                excelExport: function(e) {
             	    var customFileName = $(".k-spreadsheet-window").find(".k-textbox").val();
            	    e.workbook.fileName = customFileName;
                }
            });
            $(".k-button-icon > .k-i-file-excel").parent().on("click", function () {
                $(".k-spreadsheet-window").find(".k-textbox").val("Portföljöversikt");
            });

        }, 100);
    }

    function onChange(arg) {        
        if(arg.range._ref.bottomRight.col === columnBransch) {
            var spreadsheet = $(spreadSheetId).data("kendoSpreadsheet");
            var spreadsheetDataJson = spreadsheet.toJSON();
            var result = spreadsheetDataJson.sheets["0"].rows;
            var data = [];

            for(var i = 1; i < result.length; i++)
            {
                // Skip last as it is summary
                if(i == (result.length -1)) break;
                var isin = result[i].cells["1"].value
                var bransch = result[i].cells["2"].value;

                data.push({ ISIN: isin, Bransch: bransch });                
            }
            localStorage.setItem(localStorageStocksBranschField, JSON.stringify(data));
        }
    }

    function saveSpreadsheetDataToTable() {
        skipRunningFunctions = true;

        var spreadsheet = $(spreadSheetId).data("kendoSpreadsheet");
        var data = spreadsheet.toJSON();
        var result = data.sheets["0"].rows;
        var data = [];

        for(var i = 1; i < result.length; i++)
        {
            // Skip last as it is summary
            if(i == (result.length -1)) break;

            var bransch = result[i].cells["2"].value;
            if(bransch.length == 0)
                bransch = "Övrigt";

            data.push({
                Värdepapper: result[i].cells["0"].value,
                ISIN: result[i].cells["1"].value,
                Bransch: bransch,
                Antal: result[i].cells["3"].value,
                SenastePris: result[i].cells["4"].value.toFixed(2),
                Valuta: result[i].cells["5"].value,
                Marknadsvärde: result[i].cells["6"].value.toFixed(2)
            });
        }

        alasqlportfoliodata.saveDataToTable(data);
        skipRunningFunctions = false;
    }

    return {
        setSpreadsheetId: setSpreadsheetId,
        setData: setData,
        loadSpreadSheet: loadSpreadSheet,
        saveSpreadsheetDataToTable: saveSpreadsheetDataToTable
    };
});