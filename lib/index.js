'use strict';

const rp = require('request-promise');
const { jar } = require('request');
const request = require('request');
const fs = require('fs');
const Bluebird = require('bluebird');
const cheerio = require('cheerio');
const ora = require('ora');
const spinner = ora('Amazon Scraper on Duty');
const Json2csvParser = require('json2csv').Parser;
const EventEmitter = require('events');
const CONST = require('./constant');

const productsParser = new Json2csvParser({
    fields: ['title', 'price', 'savings', 'rating', 'reviews', 'score', 'url', 'sponsored', 'discounted', 'beforeDiscount', 'asin', 'thumbnail'],
});
const reviewsParser = new Json2csvParser({ fields: ['id', 'review_data', 'name', 'rating', 'title', 'review', 'positive', 'negative', 'avergeRating', 'totalReview', 'fiveStar', 'fiveStarLink', 'fourStar', 'fourStarLink', 'threeStar', 'threeStarLink', 'twoStar', 'twoStarLink', 'oneStar', 'oneStarLink'] });

class AmazonScraper extends EventEmitter {
    constructor({ keyword, number, sponsored, proxy, cli, save, scrapeType, asin, sort, discount, host, event, rating = [1, 5], userName, password, port }) {
        super();
        this._mainHost = `https://${host || 'www.amazon.com'}`;
        this._cookieJar = jar();
        this._scrapedProducts = {};
        this._endProductList = [];
        this._keyword = keyword;
        this._number = parseInt(number) || CONST.defaultItemLimit;
        this._continue = true;
        this._searchPage = 1;
        this._sponsored = sponsored || false;
        this._proxy = proxy;
        this._save = save || false;
        this._cli = cli || false;
        this._scrapeType = scrapeType;
        this._asin = asin;
        this._sort = sort || false;
        this._discount = discount || false;
        this._event = event || false;
        this._fileName = '';
        this._rating = rating;
        this._minRating = 1;
        this._maxRating = 5;
        this._userName = userName;
        this._password = password;
        this._port = port;
    }

    // Main request
    _request({ uri, headers, method, qs, json, body, form, timeout }) {
        return new Promise(async (resolve, reject) => {
            try {
                let response = await rp({
                    uri: uri ? `${this._mainHost}/${uri}` : this._mainHost,
                    method,
                    ...(qs ? { qs } : {}),
                    ...(body ? { body } : {}),
                    ...(form ? { form } : {}),
                    headers: {
                        'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.13; rv:69.0) Gecko/20100101 Firefox/69.0',
                        ...headers,
                        accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
                        'accept-language': 'en-US,en;q=0.5',
                        'accept-encoding': 'gzip, deflate, br',
                        te: 'trailers',
                    },
                    ...(json ? { json: true } : {}),
                    gzip: true,
                    jar: this._cookieJar,
                    resolveWithFullResponse: true,
                    ...(this._proxy ? { proxy: "http://" + this._userName + ":" + this._password + "@" + this._proxy + ":" + this._port } : {}),
                });
                resolve(response);
            } catch (error) {
                reject(error);
            }
        });
    }

    _returnError(error, reject) {
        if (this._event) {
            return this.emit('error message', error);
        } else {
            return reject(error);
        }
    }

    _startScraper() {
        return new Promise(async (resolve, reject) => {
            if (this._scrapeType === 'products') {
                if (!this._keyword) {
                    return this._returnError('Keyword is missing', reject);
                }
                if (this._number > CONST.limit.product) {
                    return this._returnError(`Wow.... slow down cowboy. Maximum you can get is ${CONST.limit.product} products`, reject);
                }
                if (typeof this._sponsored !== 'boolean') {
                    return this._returnError('Sponsored can only be {true} or {false}', reject);
                }
            }
            if (this._scrapeType === 'reviews') {
                if (!this._asin) {
                    return this._returnError('ASIN is missing', reject);
                }
                if (this._number > CONST.limit.reviews) {
                    return this._returnError(`Wow.... slow down cowboy. Maximum you can get is ${CONST.limit.reviews} reviews`, reject);
                }
            }
            if (this._scrapeType === 'allreviews') {
                if (!this._asin) {
                    return this._returnError('ASIN is missing', reject);
                }
                if (this._number > CONST.limit.reviews) {
                    return this._returnError(`Wow.... slow down cowboy. Maximum you can get is ${CONST.limit.reviews} reviews`, reject);
                }
            }
            if (!Array.isArray(this._rating)) {
                return this._returnError('rating can only be an array with length of 2', reject);
            }

            if (this._rating.length > 2) {
                return this._returnError('rating can only be an array with length of 2', reject);
            }

            if (!parseFloat(this._rating[0]) || !parseFloat(this._rating[1])) {
                return this._returnError('rating can only contain 2 float values', reject);
            }
            this._minRating = parseFloat(this._rating[0]);
            this._maxRating = parseFloat(this._rating[1]);

            if (this._minRating > this._maxRating) {
                return this._returnError(`min rating can't be larger then max rating`, reject);
            }
            if (this._cli) {
                spinner.start();
            }

            while (this._continue) {
                if (this._scrapeType === 'products') {
                    if (this._endProductList.length > 0) {
                        break;
                    }
                    if (this._searchPage == this._number) {
                        break;
                    }
                } else {
                    if (this._endProductList.length >= this._number) {
                        break;
                    }
                }
                try {
                    let body = await this._initSearch();
                    if (this._scrapeType === 'products') {
                        this._grabProduct(body);
                    }
                    if (this._scrapeType === 'reviews') {
                        this._grabReviews(body);
                    }
                    if (this._scrapeType === 'allreviews') {
                        if (this._grabAllReviews(body))
                            this._grabAllReviews(body);
                        else
                            break;
                    }
                } catch (error) {
                    if (this._event) {
                        this.emit('error message', error);
                    }
                    break;
                }
            }
            if (this._event) {
                this.emit('completed');
            }

            if (!this._event) {
                if (this._scrapeType === 'reviews') {
                    if (this._sort) {
                        this._endProductList.sort((a, b) => b.rating - a.rating);
                    }
                }
                if (this._scrapeType === 'allreviews') {
                    if (this._sort) {
                        this._endProductList.sort((a, b) => b.rating - a.rating);
                    }
                }
                if (this._scrapeType === 'products') {
                    if (this._sort) {
                        this._endProductList.sort((a, b) => b.score - a.score);
                    }
                    if (this._discount) {
                        this._endProductList = this._endProductList.filter(item => item.discounted);
                    }
                    if (this._sponsored) {
                        this._endProductList = this._endProductList.filter(item => item.sponsored);
                    }
                    resolve(this._endProductList);
                }

                this._endProductList = this._endProductList.filter(item => this._validateRating(item));

                if (this._save) {
                    if (this._scrapeType === 'products') {
                        await Bluebird.fromCallback(cb =>
                            fs.writeFile(`${this._keyword}_product_${Date.now()}.csv`, productsParser.parse(this._endProductList), cb),
                        );
                        this._fileName = `${this._keyword}_product_${Date.now()}.csv`;
                    }
                    if (this._scrapeType === 'reviews') {
                        await Bluebird.fromCallback(cb =>
                            fs.writeFile(`${this._asin}_reviews_${Date.now()}.csv`, reviewsParser.parse(this._endProductList), cb),
                        );
                        this._fileName = `${this._asin}_reviews_${Date.now()}.csv`;
                    }
                    if (this._scrapeType === 'allreviews') {
                        await Bluebird.fromCallback(cb =>
                            fs.writeFile(`${this._asin}_reviews_${Date.now()}.csv`, reviewsParser.parse(this._endProductList), cb),
                        );
                        this._fileName = `${this._asin}_reviews_${Date.now()}.csv`;
                    }
                }
                if (this._cli) {
                    spinner.stop();
                }
                if (this._save && this._fileName && this._cli) {
                    console.log(`Result was saved to: ${this._fileName}`);
                }
                resolve(this._endProductList);
            }
        });
    }

    _initSearch() {
        return new Promise(async (resolve, reject) => {
            let request;
            if (this._scrapeType === 'products') {
                request = {
                    method: 'GET',
                    uri: 's',
                    qs: {
                        k: this._keyword,
                        ...(this._searchPage > 1 ? { page: this._searchPage, ref: `sr_pg_${this._searchPage}` } : {}),
                    },
                    headers: {
                        referer: this._mainHost,
                    },
                };
            }
            if (this._scrapeType === 'reviews') {
                request = {
                    method: 'GET',
                    uri: `product-reviews/${this._asin}/`,
                    qs: {
                        ...(this._searchPage > 1 ? { pageNumber: this._searchPage } : {}),
                    },
                    headers: {
                        referer: this._mainHost,
                    },
                };
            }
            if (this._scrapeType === 'allreviews') {
                request = {
                    method: 'GET',
                    uri: `product-reviews/${this._asin}/`,
                    qs: {
                        ...(this._searchPage > 1 ? { pageNumber: this._searchPage } : {}),
                    },
                    headers: {
                        referer: this._mainHost,
                    },
                };
            }
            try {
                let response = await this._request(request);
                this._searchPage++;
                resolve(response.body);
            } catch (error) {
                reject(error);
            }
        });
    }

    _grabReviews(body) {
        let $ = cheerio.load(body.replace(/\s\s+/g, '').replace(/\n/g, ''));
        let reviewsList = $('.a-section.a-spacing-none.review-views.celwidget')[0].children;
        let avergeRating = $(`#cm_cr-product_info [data-hook="rating-out-of-text"]`)[0].children[0].data;
        let totalReview = $(`#cm_cr-product_info [data-hook="total-review-count"]`)[0].children[0].children[0].data;
        let scrapingResult = {};
        let avgRating = $(`#histogramTable`)[1].children[0].children;
        if (reviewsList.length == 0) {
            let sData = {
                avergeRating: avergeRating.replace(' out of 5', ''),
                totalReview: totalReview.replace('customer ratings', '').replace('customer rating', '').replace('global rating', '').replace('global ratings', ''),
                review: this._asin,
                rating: 5,
                fiveStar: avgRating[0].children[2].children[1].children[0].data ? avgRating[0].children[2].children[1].children[0].data.replace("%", "") : 0,
                fiveStarLink: "https://www.amazon.com/product-reviews/" + this._asin + "/ref=acr_dp_hist_5?ie=UTF8&filterByStar=five_star&reviewerType=all_reviews#reviews-filter-bar",
                fourStar: avgRating[1].children[2].children[1].children[0].data ? avgRating[1].children[2].children[1].children[0].data.replace("%", "") : 0,
                fourStarLink: "https://www.amazon.com/product-reviews/" + this._asin + "/ref=acr_dp_hist_4?ie=UTF8&filterByStar=four_star&reviewerType=all_reviews#reviews-filter-bar",
                threeStar: avgRating[2].children[2].children[1].children[0].data ? avgRating[2].children[2].children[1].children[0].data.replace("%", "") : 0,
                threeStarLink: "https://www.amazon.com/product-reviews/" + this._asin + "/ref=acr_dp_hist_3?ie=UTF8&filterByStar=three_star&reviewerType=all_reviews#reviews-filter-bar",
                twoStar: avgRating[3].children[2].children[1].children[0].data ? avgRating[3].children[2].children[1].children[0].data.replace("%", "") : 0,
                twoStarLink: "https://www.amazon.com/product-reviews/" + this._asin + "/ref=acr_dp_hist_2?ie=UTF8&filterByStar=two_star&reviewerType=all_reviews#reviews-filter-bar",
                oneStar: avgRating[4].children[2].children[1].children[0].data ? avgRating[4].children[2].children[1].children[0].data.replace("%", "") : 0,
                oneStarLink: "https://www.amazon.com/product-reviews/" + this._asin + "/ref=acr_dp_hist_1?ie=UTF8&filterByStar=one_star&reviewerType=all_reviews#reviews-filter-bar",
            }
            this._endProductList.push(sData);
            return;
        } else {
            if (reviewsList[0].attribs['id'] != undefined) {
                scrapingResult[reviewsList[0].attribs['id']] = { id: reviewsList[0].attribs['id'] };
                for (let key in scrapingResult) {
                    let search = $(`#${key} [data-hook="review-date"]`);
                    try {
                        scrapingResult[key].review_data = search[0].children[0].data;
                        scrapingResult[key].avergeRating = avergeRating.replace(' out of 5', '');
                        scrapingResult[key].totalReview = totalReview.replace('customer ratings', '').replace('customer rating', '').replace('global rating', '').replace('global ratings', '');
                        for (let i = 0; i < avgRating.length; i++) {
                            let subChilds = avgRating[i].children;
                            let subsubchild = subChilds[2].children
                            if (i == 0) {
                                scrapingResult[key].fiveStar = subsubchild[1].children[0].children[0].data ? subsubchild[1].children[0].children[0].data.replace("%", "") : 0;
                                scrapingResult[key].fiveStarLink = "https://www.amazon.com" + subsubchild[1].children[0].attribs['href'];
                            }
                            if (i == 1) {
                                scrapingResult[key].fourStar = subsubchild[1].children[0].children[0].data ? subsubchild[1].children[0].children[0].data.replace("%", "") : 0;
                                scrapingResult[key].fourStarLink = "https://www.amazon.com" + subsubchild[1].children[0].attribs['href'];
                            }
                            if (i == 2) {
                                scrapingResult[key].threeStar = subsubchild[1].children[0].children[0].data ? subsubchild[1].children[0].children[0].data.replace("%", "") : 0;
                                scrapingResult[key].threeStarLink = "https://www.amazon.com" + subsubchild[1].children[0].attribs['href'];
                            }
                            if (i == 3) {
                                scrapingResult[key].twoStar = subsubchild[1].children[0].children[0].data ? subsubchild[1].children[0].children[0].data.replace("%", "") : 0;
                                scrapingResult[key].twoStarLink = "https://www.amazon.com" + subsubchild[1].children[0].attribs['href'];
                            }
                            if (i == 4) {
                                scrapingResult[key].oneStar = subsubchild[1].children[0].children[0].data ? subsubchild[1].children[0].children[0].data.replace("%", "") : 0;
                                scrapingResult[key].oneStarLink = "https://www.amazon.com" + subsubchild[1].children[0].attribs['href'];
                            }
                        }
                    } catch (error) {
                        continue;
                    }
                }
                for (let key in scrapingResult) {
                    let search = $(`#${key} .a-profile-name`);

                    try {
                        scrapingResult[key].name = search[0].children[0].data;
                    } catch (error) {
                        continue;
                    }
                }
                for (let key in scrapingResult) {
                    let search = $(`#${key} [data-hook="review-star-rating"]`);

                    try {
                        scrapingResult[key].rating = parseFloat(search[0].children[0].children[0].data.split(' ')[0]);
                    } catch (error) {
                        continue;
                    }
                }
                for (let key in scrapingResult) {
                    let search = $(`#${key} [data-hook="review-title"]`);

                    try {
                        scrapingResult[key].title = $(search[0])
                            .text()
                            .toString();
                    } catch (error) {
                        continue;
                    }
                }
                for (let key in scrapingResult) {
                    try {
                        scrapingResult[key].review = this._asin;
                    } catch (error) {
                        continue;
                    }
                }

                for (let key in scrapingResult) {
                    if (this._event) {
                        let item = this._validateRating(scrapingResult[key]);
                        if (item) {
                            this.emit('item', scrapingResult[key]);
                        }
                    }
                    this._endProductList.push(scrapingResult[key]);
                }
                return;
            } else {
                let sData = {
                    avergeRating: avergeRating.replace(' out of 5', ''),
                    totalReview: totalReview.replace('customer ratings', '').replace('customer rating', '').replace('global rating', '').replace('global ratings', ''),
                    review: this._asin,
                    rating: 5,
                    fiveStar: avgRating[0].children[2].children[1].children[0].data ? avgRating[0].children[2].children[1].children[0].data.replace("%", "") : 0,
                    fiveStarLink: "https://www.amazon.com/product-reviews/" + this._asin + "/ref=acr_dp_hist_5?ie=UTF8&filterByStar=five_star&reviewerType=all_reviews#reviews-filter-bar",
                    fourStar: avgRating[1].children[2].children[1].children[0].data ? avgRating[1].children[2].children[1].children[0].data.replace("%", "") : 0,
                    fourStarLink: "https://www.amazon.com/product-reviews/" + this._asin + "/ref=acr_dp_hist_4?ie=UTF8&filterByStar=four_star&reviewerType=all_reviews#reviews-filter-bar",
                    threeStar: avgRating[2].children[2].children[1].children[0].data ? avgRating[2].children[2].children[1].children[0].data.replace("%", "") : 0,
                    threeStarLink: "https://www.amazon.com/product-reviews/" + this._asin + "/ref=acr_dp_hist_3?ie=UTF8&filterByStar=three_star&reviewerType=all_reviews#reviews-filter-bar",
                    twoStar: avgRating[3].children[2].children[1].children[0].data ? avgRating[3].children[2].children[1].children[0].data.replace("%", "") : 0,
                    twoStarLink: "https://www.amazon.com/product-reviews/" + this._asin + "/ref=acr_dp_hist_2?ie=UTF8&filterByStar=two_star&reviewerType=all_reviews#reviews-filter-bar",
                    oneStar: avgRating[4].children[2].children[1].children[0].data ? avgRating[4].children[2].children[1].children[0].data.replace("%", "") : 0,
                    oneStarLink: "https://www.amazon.com/product-reviews/" + this._asin + "/ref=acr_dp_hist_1?ie=UTF8&filterByStar=one_star&reviewerType=all_reviews#reviews-filter-bar",
                }
                this._endProductList.push(sData);
                return;
            }
        }
    }

    _grabAllReviews(body) {
        let $ = cheerio.load(body.replace(/\s\s+/g, '').replace(/\n/g, ''));
        let reviewsList = $('.a-section.a-spacing-none.review-views.celwidget')[0].children;
        let scrapingResult = {};

        for (let i = 0; i < reviewsList.length; i++) {
            let totalInResult = Object.keys(scrapingResult).length + this._endProductList.length;
            if (totalInResult >= this._number) {
                break;
            }
            if (!reviewsList[i].attribs['id']) {
                continue;
            }
            scrapingResult[reviewsList[i].attribs['id']] = { id: reviewsList[i].attribs['id'] };
        }
        for (let key in scrapingResult) {
            let search = $(`#${key} [data-hook="review-date"]`);

            try {
                scrapingResult[key].review_data = search[0].children[0].data;
            } catch (error) {
                continue;
            }
        }
        for (let key in scrapingResult) {
            let search = $(`#${key} .a-profile-name`);

            try {
                scrapingResult[key].name = search[0].children[0].data;
            } catch (error) {
                continue;
            }
        }
        for (let key in scrapingResult) {
            let search = $(`#${key} [data-hook="review-star-rating"]`);

            try {
                scrapingResult[key].rating = parseFloat(search[0].children[0].children[0].data.split(' ')[0]);
            } catch (error) {
                continue;
            }
        }
        for (let key in scrapingResult) {
            let search = $(`#${key} [data-hook="review-title"]`);

            try {
                scrapingResult[key].title = $(search[0])
                    .text()
                    .toString();
            } catch (error) {
                continue;
            }
        }
        for (let key in scrapingResult) {
            let search = $(`#${key} [data-hook="review-body"]`);

            try {
                scrapingResult[key].review = $(search[0]).text();
                scrapingResult[key].positive = '';
                scrapingResult[key].negative = '';
            } catch (error) {
                continue;
            }
        }
        for (let key in scrapingResult) {
            if (this._event) {
                let item = this._validateRating(scrapingResult[key]);
                if (item) {
                    this.emit('item', scrapingResult[key]);
                }
            }
            this._endProductList.push(scrapingResult[key]);
        }
        return;
    }

    _grabProduct(body) {
        let $ = cheerio.load(body.replace(/\s\s+/g, '').replace(/\n/g, ''));
        let productList = $('div[data-index]');
        let scrapingResult = {};
        for (let i = 0; i < productList.length; i++) {

            // if (this._cli) {
            //     spinner.text = `Found ${this._endProductList.length + productList.length} products`;
            // }
            // let totalInResult = Object.keys(scrapingResult).length + this._endProductList.length;
            // if (totalInResult >= this._number) {
            //     break;
            // }
            // if (!productList[i].attribs['data-asin']) {
            //     continue;
            // }
            let pageno = 0;
            if (productList.length > 48)
                pageno = 48;
            else if (productList.length < 48)
                pageno = 16;
            if (this._asin.toString() == productList[i].attribs['data-asin']) {
                let data = {
                    asin: productList[i].attribs['data-asin'],
                    keyword: this._keyword,
                    dataIndex: (this._searchPage - 1) == 1 ? (parseInt(productList[i].attribs['data-index']) + 1) : (pageno * (this._searchPage - 2)) + (parseInt(productList[i].attribs['data-index']) + 1),
                    pageIndex: (this._searchPage - 1),
                    lastUpdated: new Date(),
                    searchPage: this._number
                };
                this._endProductList.push(data);
                break;
            }
        }

        // for (let key in scrapingResult) {
        //     try {
        //         let priceSearch = $(`div[data-asin=${key}] span[data-a-size="l"]`)[0] || $(`div[data-asin=${key}] span[data-a-size="m"]`)[0];
        //         let discountSearch = $(`div[data-asin=${key}] span[data-a-strike="true"]`)[0];
        //         let ratingSearch = $(`div[data-asin=${key}] .a-icon-star-small`)[0];
        //         let titleThumbnailSearch = $(`div[data-asin=${key}] [data-image-source-density="1"]`)[0];
        //         let urlSearch = $(`div[data-asin=${key}] .a-link-normal`);

        //         if (priceSearch) {
        //             scrapingResult[key].price = $(priceSearch.children[0])
        //                 .text()
        //                 .replace(/[^D+0-9.,]/g, '');
        //         }

        //         if (discountSearch) {
        //             scrapingResult[key].beforeDiscount = $(discountSearch.children[0])
        //                 .text()
        //                 .replace(/[^D+0-9.,]/g, '');
        //             scrapingResult[key].discounted = true;
        //             let savings = scrapingResult[key].beforeDiscount - scrapingResult[key].price;
        //             if (savings <= 0) {
        //                 scrapingResult[key].discounted = false;
        //                 scrapingResult[key].beforeDiscount = 0;
        //             } else {
        //                 scrapingResult[key].savings = savings;
        //             }
        //         }

        //         if (ratingSearch) {
        //             scrapingResult[key].rating = parseFloat(ratingSearch.children[0].children[0].data);
        //             scrapingResult[key].reviews = parseInt(ratingSearch.parent.parent.parent.next.attribs['aria-label'].replace(/\,/g, ''));
        //             scrapingResult[key].score = parseFloat(scrapingResult[key].rating * scrapingResult[key].reviews).toFixed(2);
        //         }

        //         if (titleThumbnailSearch) {
        //             scrapingResult[key].title = titleThumbnailSearch.attribs.alt;
        //             scrapingResult[key].thumbnail = titleThumbnailSearch.attribs.src;
        //         }

        //         if (urlSearch) {
        //             let url = urlSearch[0].attribs.href;
        //             if (url.indexOf('/gcx/-/') > -1) {
        //                 url = urlSearch[1].attribs.href;
        //             }

        //             if (url.indexOf('/gp/') > -1) {
        //                 scrapingResult[key].sponsored = true;
        //             }

        //             scrapingResult[key].url = `${this._mainHost}${url}`;
        //         }
        //     } catch (err) {
        //         continue;
        //     }
        // }
        // for (let key in scrapingResult) {
        //     if (this._event) {
        //         this._eventProductFilter(scrapingResult[key]);
        //     }
        //     this._endProductList.push(scrapingResult[key]);
        // }
        return;
    }

    /**
     * If {sponsored} or {discounted} filters are enabled then we will filter the output data
     * @param {*} item
     */
    _eventProductFilter(item) {
        if (this._discount && this._sponsored) {
            if (!item.discounted && !item.sponsored) return;
        }
        if (this._discount && !this._sponsored) {
            if (!item.discounted) return;
        }
        if (!this._discount && this._sponsored) {
            if (!item.sponsored) return;
        }
        item = this._validateRating(item);
        if (item) {
            return this.emit('item', item);
        }
    }

    /**
     * Check item rating
     * @param {*} item
     */
    _validateRating(item) {
        if (item.rating >= this._minRating && item.rating <= this._maxRating) {
            return item;
        }
        return false;
    }
}

module.exports = AmazonScraper;
