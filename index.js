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

let getPermutations = function (queueWorkload, fetchData, processResults) {
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
              shuffle(zipCodes);

              setTimeout(() => {
                // Modify the array for testing.
                zipCodes.splice(0, 600); // Remove first 600 useless permutations.
                // zipCodes.splice(3, zipCodes.length); // temp
                spinner.succeed();
                queueWorkload(zipCodes, fetchData, processResults);
              }, 2000);
            }
          }
        }
      }
    }
  }
};

let queueWorkload = function (zipCodes, fetchData, processResults) {
  const async = require('async');

  let q = async.queue(function (task, callback) {
    fetchData(task, processResults, callback);
    // callback();
  }, 1);

  q.drain = function () {
    console.log('\nFinished processing queue.\n');
    mongoose.connection.close();
    // Finish
  }

  q.push(zipCodes, function (err) {
    if (err) {
      console.log(`Error: ${err}`);
    }
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
  if (results && results.resultStatus !== 'INVALID-ZIP CODE') {
    let zip = new ZipCode({
      zip5: results.zip5,
      defaultCity: results.defaultCity,
      defaultState: results.defaultState,
      defaultRecordType: results.defaultRecordType,
      lastUpdated: (new Date).getTime(),
      citiesList: results.citiesList,
      nonAcceptList: results.nonAcceptList,
    });

    let z = Object.assign(zip, zip._doc);
    delete z._id;

    let query = { zip5: z.zip5 };
    ZipCode.findOneAndUpdate(query, { $set: { zip5: zip.zip5, defaultCity: zip.defaultCity, defaultState: zip.defaultState, defaultRecordType: zip.defaultRecordType, lastUpdated: zip.lastUpdated, citiesList: zip.citiesList, nonAcceptList: zip.nonAcceptList } }, { upsert: true, new: true }, function (err, doc) {
      debugger;
      callback();
    });

  } else {
    // Nothing to save
    callback();
  }
};

console.log('\n');
getPermutations(queueWorkload, fetchData, processResults);