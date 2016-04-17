const I2C_DISPLAY_ADDRESS = 0x3F;//0x20;
const PIN_BUTTON = 27;
const PIN_BUTTON_LED = 26;
const PIN_DHT_SENSOR = 22;
const PIN_LCD_RED = 12;
const PIN_LCD_GREEN = 13;
const PIN_LCD_BLUE = 19;

const COLOR_OFF = 0;
const COLOR_WHITE = 1;
const COLOR_RED = 2;
const COLOR_ORANGE = 3;
const COLOR_BLUE = 4;

const TIMER_STATE_STOPPED = 0;
const TIMER_STATE_RUNNING = 1;
const TIMER_STATE_ERROR = 2;

const LED_STATE_OFF = 0;
const LED_STATE_ON = 1;
const LED_STATE_BLINK_OFF = 2;
const LED_STATE_BLINK_ON = 3;

const MAX_LINE_LENGTH = 16;

require('dotenv').config();

var _ = require('lodash'),
    dateFormat = require('dateformat'),
    Harvest = require('harvest'),
    harvest = new Harvest({
        subdomain: process.env.HARVEST_SUBDOMAIN,
        email: process.env.HARVEST_EMAIL,
        password: process.env.HARVEST_PASSWORD
    }),
    harvestProjects = {},
    LCDPLATE = require('adafruit-i2c-lcd').plate,
    lcd = new LCDPLATE(1, I2C_DISPLAY_ADDRESS, -1),
    rpio = require('rpio'),
    dhtSensor = require('node-dht-sensor'),
    currentTaskDescription = undefined,
    currentTaskStart = 0,
    harvestState = TIMER_STATE_STOPPED,
    ledState = LED_STATE_ON,
    temperature = '---'
;

// Initialize
lcd.clear();
lcd.message('Harvest Clock\nStarting up...');

dhtSensor.initialize(22, PIN_DHT_SENSOR);

rpio.init({gpiomem: false});

// Initialize the button
rpio.open(PIN_BUTTON, rpio.INPUT, rpio.PULL_DOWN);
rpio.poll(PIN_BUTTON, pollButton, rpio.POLL_HIGH);

// Initialize the button's LED
rpio.open(PIN_BUTTON_LED, rpio.OUTPUT, rpio.LOW);

// Initialize the display's color pins
rpio.pwmSetClockDivider(1024);
rpio.pwmSetRange(PIN_LCD_RED, 256);
rpio.pwmSetRange(PIN_LCD_GREEN, 256);

rpio.open(PIN_LCD_RED, rpio.PWM);
rpio.open(PIN_LCD_GREEN, rpio.PWM);

rpio.open(PIN_LCD_BLUE, rpio.OUTPUT, rpio.LOW);
setBacklight(COLOR_WHITE);

// TODO: Should we update this list regularly?
setTimeout(loadHarvestProjects, 10);

updateTemperature();
updateHarvestTimer();

setInterval(updateTemperature, 5000);
setInterval(updateHarvestTimer, 2000);
setInterval(updateLED, 500);

setTimeout(display, 1000);

function display() {
    var output = '';
    output += dateFormat(new Date(), 'mmm dd HH:MM');
    // We don't need no stinking left-pad
    output += ' '.repeat(MAX_LINE_LENGTH - output.length - temperature.length);
    output += temperature;
    output += '\n';

    switch (harvestState) {
        case TIMER_STATE_STOPPED:
            output += 'No timer running';

            setBacklight(COLOR_BLUE);

            ledState = LED_STATE_OFF;
            break;
        case TIMER_STATE_ERROR:
            output += 'Harvest error';

            setBacklight(COLOR_RED);
            break;
        case TIMER_STATE_RUNNING:
            var duration = getCurrentTaskDuration() + ': ';
            var description = currentTaskDescription.substr(0, MAX_LINE_LENGTH - duration.length);
            output += duration + description;

            setBacklight(COLOR_ORANGE);

            ledState = LED_STATE_ON;
            break;
    }

    lcd.clear();
    lcd.message(output);
}

function updateLED() {
    switch (ledState) {
        case LED_STATE_OFF:
            rpio.write(PIN_BUTTON_LED, 0);
            break;
        case LED_STATE_ON:
            rpio.write(PIN_BUTTON_LED, 1);
            break;
        case LED_STATE_BLINK_OFF:
            rpio.write(PIN_BUTTON_LED, 0);
            ledState = LED_STATE_BLINK_ON;
            break;
        case LED_STATE_BLINK_ON:
            rpio.write(PIN_BUTTON_LED, 1);
            ledState = LED_STATE_BLINK_OFF;
            break;
    }
}

function setBacklight(color) {
    switch (color) {
        case COLOR_OFF:
            rpio.pwmSetData(PIN_LCD_RED, 0);
            rpio.pwmSetData(PIN_LCD_GREEN, 0);
            rpio.write(PIN_LCD_BLUE, 0);
            break;
        case COLOR_WHITE:
            rpio.pwmSetData(PIN_LCD_RED, 255);
            rpio.pwmSetData(PIN_LCD_GREEN, 255);
            rpio.write(PIN_LCD_BLUE, 1);
            break;
        case COLOR_BLUE:
            rpio.pwmSetData(PIN_LCD_RED, 0x33);
            rpio.pwmSetData(PIN_LCD_GREEN, 0x99);
            rpio.write(PIN_LCD_BLUE, 1);
            break;
        case COLOR_RED:
            rpio.pwmSetData(PIN_LCD_RED, 255);
            rpio.pwmSetData(PIN_LCD_GREEN, 0x33);
            rpio.write(PIN_LCD_BLUE, 1);
            break;
        case COLOR_ORANGE:
            rpio.pwmSetData(PIN_LCD_RED, 0xFF);
            rpio.pwmSetData(PIN_LCD_GREEN, 0x66);
            rpio.write(PIN_LCD_BLUE, 1);
            break;
    }
}

function pollButton() {
    console.log('Button pressed!');
}

function getCurrentTaskDuration() {
    var now = (new Date()).getTime();
    var durationInMilliseconds = now - currentTaskStart;

    var oneHourInMs = 3600000;

    return (durationInMilliseconds / oneHourInMs).toFixed(2);
}

function updateTemperature() {
    var readout = dhtSensor.read();
    temperature = readout.temperature.toFixed(1) + '°';
}

function updateHarvestTimer() {
    harvest.TimeTracking.daily({}, function(err, tasks) {
        if (err) {
            harvestState = TIMER_STATE_ERROR;
            return;
        }

        currentTask = _.find(tasks.day_entries, function(entry) {
            return entry.hasOwnProperty('timer_started_at');
        });

        harvestState = (currentTask === undefined) ? TIMER_STATE_STOPPED : TIMER_STATE_RUNNING;
        ledState = (currentTask === undefined) ? LED_STATE_OFF : LED_STATE_ON;

        // TODO: Show real data
        currentTaskDescription = '[ABCD] Growth';
        currentTaskStart = (new Date()).getTime() - 9000;
    })
}

function loadHarvestProjects() {
    harvest.Projects.list({}, function(err, projectList) {
        if (err) {
            console.log(err.message);
            process.exit(1);
        }

        harvestProjects = {};
        for (var i = 0, len = projectList.length; i < len; i++) {
            harvestProjects[projectList[i].project.id] = projectList[i].project;
        }
    });
};
