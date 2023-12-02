const express = require('express');
const bodyParser = require('body-parser');
const path = require('path');
const csv = require('csv-parser');
const fs = require('fs');
const tf = require('@tensorflow/tfjs-node');

const app = express();
const port = 3000;

let passwordDataset = []; // To store the dataset

app.use(express.static(path.join(__dirname, 'public')));
app.use(bodyParser.urlencoded({extended: true}));
app.use(bodyParser.json());


fs.createReadStream('password_dataset.csv')
    .pipe(csv())
    .on('data', (row) => {
        passwordDataset.push({password: row.password, strength: parseInt(row.strength)});
    })
    .on('end', () => {
        console.log('Dataset loaded');


        app.post('/validatePassword', (req, res) => {
            const username = req.body.username;
            const password = req.body.password;

            const fixedInputLength = 12;

            const trainingSet = passwordDataset.map(({password, strength}) => {
                // Map each character's char code and normalize
                const inputArray = password.split('').map(char => char.charCodeAt(0) / 255);

                // Ensure all input numbers have the same length by rounding and padding
                const formattedInputArray = Array.from({length: fixedInputLength}, (_, i) => {
                    const index = Math.floor(i * (inputArray.length / fixedInputLength));
                    return inputArray[index] || 0; // Pad with zeros if necessary
                });

                return {
                    input: formattedInputArray,
                    output: [strength === 0 ? 1 : 0, strength === 1 ? 1 : 0, strength === 2 ? 1 : 0],
                };
            });

            // Convert training data and output data to TensorFlow.js tensors
            const inputData = tf.tensor2d(trainingSet.map(entry => entry.input));
            const outputData = tf.tensor2d(trainingSet.map(entry => entry.output));

            console.log('Input Data:', inputData);
            console.log('Input Data Shape:', inputData.shape);

            const model = tf.sequential();
            model.add(tf.layers.dense({units: 10, inputShape: [fixedInputLength], activation: 'sigmoid'}));
            model.add(tf.layers.dense({units: 3, activation: 'softmax'}));

            model.compile({
                optimizer: tf.train.adam(),
                loss: 'categoricalCrossentropy',
                metrics: ['accuracy'],
            });


            model.fit(inputData, outputData, {
                epochs: 100,
                shuffle: true,
            }).then(trainingStats => {
                // console.log('Final accuracy', trainingStats.history.acc);
            });


            // Assuming 'inputPassword' is the password you want to check
            const passwordToPredict = password;

            // Map each character's char code and normalize
            const inputArray = passwordToPredict.split('').map(char => char.charCodeAt(0) / 255);

            // Ensure all input numbers have the same length by rounding and padding
            const formattedInputArray = inputArray.map(num => {
                const roundedNum = num.toFixed(fixedInputLength - 1); // -1 to account for the decimal point
                return parseFloat(roundedNum);
            });

            // Pad or truncate the array to make it consistent with TensorFlow.js input shape [12]
            while (formattedInputArray.length < 12) {
                formattedInputArray.push(0); // Pad with zeros
            }

            // If the array is longer than 12, truncate it
            if (formattedInputArray.length > 12) {
                formattedInputArray.length = 12;
            }

            // Convert the formatted input array to a 2D tensor
            const inputTensor = tf.tensor2d([formattedInputArray]);

            // Make predictions
            const predictions = model.predict(inputTensor);
            // predictions.print();

            const predictedStrength = predictions.dataSync();

            const threshold = 0.5; // Adjust this threshold as needed
            const predictedCategory = predictions.argMax(1).dataSync()[0];
            var PredictedSummary = '';
            if (predictions.dataSync()[predictedCategory] > threshold) {
                console.log('Predicted Category:', predictedCategory);
                PredictedSummary = 'The AI predicts that the password is robust';
            } else {
                PredictedSummary = 'The AI predicts that the password is medium-strength/week';
            }

            console.log('Predicted Category', predictions.dataSync()[predictedCategory]);
            console.log('Predicted Category', predictedCategory);

            // Check for similar passwords
            let isSimilarPassword = false;
            if (hasSimilarPassword(password)) {
                console.log('Similar password detected. Please choose a unique one.')
                isSimilarPassword = true;
            }

            /**
             * Requirements 2
             * The software should enforce basic rules like minimum password length, and complexity, avoiding parts of username or any public information
             * the inclusion of numerical and special characters, and other ground rules while providing user flexibility
             * @type {boolean}
             */
            let isPassphrase = false;

            const config = {
                allowPassphrases: true,
                minPhraseLength: 20,
            }

            const requirements = {
                lengthRequirement: password.length >= 10,
                maxLengthRequirement: password.length < 128,
                uppercaseRequirement: /[A-Z]/.test(password),
                numberRequirement: /\d/.test(password),
                specialCharRequirement: /[!@#$%^&*(),.?":{}|<>]/.test(password),
                noSequentialChars: !hasSequentialChars(password),
                noRepeatingChars: !hasRepeatingChars(password),
                noUsernameParts: !hasUsernameParts(username, password),
            };

            if (
                config.allowPassphrases === true &&
                password.length >= config.minPhraseLength
            ) {
                isPassphrase = true;
            }
            /**
             * Requirement:4
             * Password strength testers should give a thumbs up only when all the test cases pass
             */

            let isStrongPassword = false;
            if (!isPassphrase) {
                isStrongPassword = Object.values(requirements).every((requirement) => requirement);
            }

            res.setHeader('Content-Type', 'application/json');
            if (isPassphrase || isStrongPassword) {
                requirements.thumbsUp = true;
                requirements.isPassphrase = isPassphrase;
            }
            requirements.isSimilarPassword = isSimilarPassword;
            requirements.PredictedSummary = PredictedSummary;
            res.json(requirements);
        });

    });

function hasSequentialChars(password) {
    // Check for sequential characters (e.g., abc, 123)
    for (let i = 0; i < password.length - 2; i++) {
        if (
            password.charCodeAt(i) === password.charCodeAt(i + 1) - 1 &&
            password.charCodeAt(i + 1) === password.charCodeAt(i + 2) - 1
        ) {
            return true;
        }
    }
    return false;
}

function hasRepeatingChars(password) {
    // Check for repeating characters (e.g., aaa)
    for (let i = 0; i < password.length - 2; i++) {
        if (password.charAt(i) === password.charAt(i + 1) && password.charAt(i + 1) === password.charAt(i + 2)) {
            return true;
        }
    }
    return false;
}

function hasUsernameParts(username, password) {
    // Check if the password contains parts of the username
    const usernameParts = username.split(/[._-]/); // Split username by common delimiters

    for (const part of usernameParts) {
        if (password.includes(part)) {
            return true;
        }
    }

    return false;
}

// Check for similar passwords
function hasSimilarPassword(inputPassword) {
    const similarityThreshold = 0.7; // Adjust as needed

    return passwordDataset.some(({password}) => {
        const similarity = calculateSimilarity(inputPassword, password);
        return similarity > similarityThreshold;
    });
}

// Calculate degree of similarity
function calculateSimilarity(str1, str2) {
    const set1 = new Set(str1);
    const set2 = new Set(str2);
    const intersection = new Set([...set1].filter(char => set2.has(char)));
    return intersection.size / Math.min(set1.size, set2.size);
}

app.listen(port, () => {
    console.log(`Server is running at http://localhost:${port}`);
});