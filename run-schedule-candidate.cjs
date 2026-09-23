const { getSchedule } = require('/tmp/schedule-api-candidate.js');

getSchedule(process.argv[2] || '2026-08-18')
  .then((value) => console.log(JSON.stringify(value)))
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
