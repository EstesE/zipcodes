const fetch = require('node-fetch');
const FormData = require('form-data');
const ora = require('ora');
const config = require('config');
const zipCodes = [];
const mongoose = require('mongoose');
const notifier = require('node-notifier');
mongoose.Promise = require('bluebird');

let ZipCode = mongoose.model('zip', {
  zip5: String,
  defaultCity: String,
  defaultState: String,
  defaultRecordType: String,
  lastUpdated: Date,
  location: Object,
  county: String,
  township: String,
  timezone: Object,
  citiesList: Array,
  nonAcceptList: Array
});

mongoose.connect(config.data.connection, { useNewUrlParser: true }, err => {
  if (err) {
    notifier.notify({
      title: err.name,
      message: err.message
    });
    process.exit(1);
  }
  // console.log('connected')
});

let getPermutations = function (generateFile, queueWorkload, fetchData, processResults) {
  let spinner = ora('Generating permutations...').start();
  for (let a = 0; a <= 9; a++) {
    for (let b = 0; b <= 9; b++) {
      for (let c = 0; c <= 9; c++) {
        for (let d = 0; d <= 9; d++) {
          for (let e = 0; e <= 9; e++) {
            zipCodes.push(a.toString() + b.toString() + c.toString() + d.toString() + e.toString());
            if (a == 9 && b == 9 && c == 9 && d == 9 && e == 9) {
              function shuffle(array) {
                var currentIndex = array.length, temporaryValue, randomIndex;

                // While there remain elements to shuffle...
                while (0 !== currentIndex) {

                  // Pick a remaining element...
                  randomIndex = Math.floor(Math.random() * currentIndex);
                  currentIndex -= 1;

                  // And swap it with the current element.
                  temporaryValue = array[currentIndex];
                  array[currentIndex] = array[randomIndex];
                  array[randomIndex] = temporaryValue;
                }

                return array;
              }

              // Shuffle array???
              if (config.shuffle === true) {
                shuffle(zipCodes);
              }

              setTimeout(() => {
                // Modify the array for testing.
                zipCodes.splice(0, 600); // Remove first 600 useless permutations.
                // zipCodes.splice(3, zipCodes.length); // temp: make array smaller for testing
                spinner.succeed();
                generateFile(zipCodes, fetchData, processResults);
              }, 2000);
            }
          }
        }
      }
    }
  }
};

let generateFile = function (zipCodes, fetchData, processResults) {
  const fs = require('fs');
  let fileContent = fs.readFileSync('zipcodes.json');
  let content = JSON.parse(fileContent);
  if (content.zipcodes.length === 0) {
    let stream = fs.createWriteStream("zipcodes.json");
    let zips = '"' + zipCodes.join('","') + '"';

    stream.write(`{ "zipcodes": [${zips}] }`);
    stream.end(() => {
      queueWorkload(zipCodes, fetchData, processResults);
    });
  } else {
    queueWorkload(content.zipcodes, fetchData, processResults);
  }
};

let queueWorkload = (zipCodes, fetchData, processResults) => {
  const async = require('async');
  const fs = require('fs');
  let fileContent = fs.readFileSync('zipcodes.json');
  let content = JSON.parse(fileContent);

  async.eachSeries(content.zipcodes, function (zip, callback) {
    setTimeout(function () {
      let spinner = ora(`Fetching data for ${zip}`).start();
      const form = new FormData();
      form.append('zip', zip);

      async function getData() {

        let zipResults = await fetch(config.url, { method: 'POST', body: form })
          .then((res) => {
            return res.json();
          })
          .then((json) => {
            return json;
          })
          .catch((err) => {
            if (err) {
              spinner.fail(`Error: ${err.message}`);
            }
          });

        if (zipResults.resultStatus !== "INVALID-ZIP CODE") {
          let options = {
            select: `${zipResults.defaultCity}+${zipResults.defaultState}+${zipResults.zip5}`
          };
          let hasCoor = false;
          let geoResults = await fetch(config.geocoding.baseApiURL + options.select + '&key=' + config.geocoding.key).then(response => {
            hasCoor = true;
            return response.json();
          }).catch((err) => {
            if (err) {
              spinner.fail(`Error: ${err.message}`);
            }
          });

          // Get elevation
          let elevation = {};
          let timezone = {};
          if (geoResults && geoResults.results.length > 0) {
            elevation = await fetch(`${config.elevation.baseApiURL}${geoResults.results[0].geometry.location.lat},${geoResults.results[0].geometry.location.lng}`).then(response => {
              return response.json();
            }).catch((err) => {
              console.log(`Error: ${err}`);
            });

            // Get Timezone
            timezone = await fetch(`${config.timezone.baseApiURL}${geoResults.results[0].geometry.location.lat},${geoResults.results[0].geometry.location.lng}&timestamp=${Math.floor(Date.now() / 1000)}`).then(response => {
              return response.json();
            }).catch((err) => {
              console.log(`Error: ${err}`);
            });
          }

          spinner.succeed();
          const fs = require('fs');
          let fileContent = fs.readFileSync('zipcodes.json');
          let content = JSON.parse(fileContent);
          content.zipcodes.shift();
          let stream = fs.createWriteStream("zipcodes.json");
          let zips = '"' + content.zipcodes.join('","') + '"';
          stream.write(`{ "zipcodes": [${zips}] }`);

          if (hasCoor && geoResults && geoResults.results && geoResults.results[0] && geoResults.results[0].geometry && geoResults.results[0].geometry.location) {
            zipResults.location = geoResults.results[0].geometry.location;
            if (typeof (elevation) !== 'undefined') {
              zipResults.location.elevation = elevation.results[0].elevation;
            }
            if (typeof (timezone) !== 'undefined') {
              delete timezone.status;
              zipResults.timezone = timezone;
            }

            function search(nameKey, myArray) {
              function arraysEqual(arr1, arr2) {
                if (arr1.length !== arr2.length)
                  return false;
                for (var i = arr1.length; i--;) {
                  if (arr1[i] !== arr2[i])
                    return false;
                }
                return true;
              }

              for (var i = 0; i < myArray.length; i++) {
                let test = arraysEqual(nameKey, myArray[i].types);
                if (test === true) {
                  return myArray[i].long_name;
                }
              }
            }

            var county = search(["administrative_area_level_2", "political"], geoResults.results[0].address_components);
            var township = search(["administrative_area_level_3", "political"], geoResults.results[0].address_components);

            zipResults.county = county;
            zipResults.township = township;
          }
          let myJson = zipResults;

          stream.end(() => {
            processResults({ zip: zip, results: myJson }, callback);
          });
          // 

        } else {
          // processResults({ zip: {}, results: {} }, callback);
          spinner.succeed();
          const fs = require('fs');
          let fileContent = fs.readFileSync('zipcodes.json');
          let content = JSON.parse(fileContent);
          content.zipcodes.shift();
          let stream = fs.createWriteStream("zipcodes.json");
          let zips = '"' + content.zipcodes.join('","') + '"';
          stream.write(`{ "zipcodes": [${zips}] }`);
          stream.end(() => {
            processResults({ zip: zip, results: {} }, callback);
          });
        }

      }

      getData();


    }, config.timeout);
  });
};

let fetchData = function (zip, processResults, callback) {
  let spinner = ora(`Fetching data for ${zip}`).start();
  setTimeout(function () {
    const form = new FormData();
    form.append('zip', zip);
    fetch(config.url, { method: 'POST', body: form })
      .then((res) => {
        return res.json();
      })
      .then((json) => {
        spinner.succeed();
        processResults({ zip: zip, results: json }, callback);
      })
      .catch((err) => {
        if (err) {
          spinner.fail(`Error: ${err.message}`);
        }
      });
  }, config.timeout);
};

let processResults = (results, callback) => {
  results = results.results;
  if (results && typeof (results.resultStatus) !== 'undefined' && results.resultStatus !== 'INVALID-ZIP CODE') {
    let zip = new ZipCode({
      zip5: results.zip5,
      defaultCity: results.defaultCity,
      defaultState: results.defaultState,
      defaultRecordType: results.defaultRecordType,
      lastUpdated: (new Date).getTime(),
      location: results.location,
      county: results.county,
      township: results.township,
      timezone: results.timezone,
      citiesList: results.citiesList,
      nonAcceptList: results.nonAcceptList,
    });

    let z = Object.assign(zip, zip._doc);
    delete z._id;

    let query = { zip5: z.zip5 };
    ZipCode.findOneAndUpdate(query, { $set: { zip5: zip.zip5, defaultCity: zip.defaultCity, defaultState: zip.defaultState, defaultRecordType: zip.defaultRecordType, lastUpdated: zip.lastUpdated, location: zip.location, county: zip.county, township: zip.township, timezone: zip.timezone, citiesList: zip.citiesList, nonAcceptList: zip.nonAcceptList } }, { upsert: true, new: true }, function (err, doc) {
      callback();
    });

  } else {
    // Nothing to save
    callback();
  }
};

console.log('\n');
getPermutations(generateFile, queueWorkload, fetchData, processResults);
