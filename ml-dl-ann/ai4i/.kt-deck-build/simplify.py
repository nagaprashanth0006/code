from pathlib import Path
p=Path('.kt-deck-build/revise.mjs');s=p.read_text()
changes={
'Data and feature decisions':'Understand the data and choose inputs',
'Algorithm choice and data checks':'Choose a model and check the data',
'Training, validation and evaluation':'Train the model and check its results',
'Live inference through Kafka':'Make predictions using Kafka',
'An LLM application that calls the model':'Let an AI assistant use the model',
'ML training flow / pipeline':'ML training: the main steps',
'Fit preprocessing':'Learn data preparation',
'Train candidates':'Train models',
'Validate + threshold':'Choose alert cutoff',
'Export pipeline + metadata':'Save the model and its settings',
'Same fitted preprocessing\\nat training and inference':'Use the same data preparation\\nfor training and predictions',
'10,000 observations':'10,000 data rows',
'339 failure rows (3.39%)\\nOne row describes an operating state and its outcome':'339 rows show a failure (3.39%)\\nEach row has machine readings and a failure label',
'The extension adds simulated signals, missingness and leakage examples':'AI4I+ adds example sensors, missing values and answer-revealing fields',
'Target: current machine failure condition':'Goal: identify a failure from the current machine readings',
'Features of the dataset':'Features: inputs to the model',
'Model inputs':'What we use',
'Excluded inputs':'What we leave out',
'Machine failure target\\nFailure-mode indicators\\nPost-failure alarm and failure code\\nEmergency stop\\nIDs and unused context / noise':'The failure label we want to predict\\nFields that reveal the type of failure\\nAlarms and codes recorded after failure\\nEmergency stop\\nIDs and extra fields we do not need',
'Key question: would this value exist when we make the prediction?':'Would we know this value before asking the model?',
'Algorithm selection':'Choosing an algorithm',
'Baseline: what happens when we ignore sensors?':'Always predicts “normal”. Our starting point.',
'Readable rules reveal thresholds and interactions':'Uses simple rules we can read and explain.',
'Primary model for nonlinear tabular relationships':'Combines many trees to find more complex patterns.',
'Compare training and validation performance, including rare failures':'Check how each model performs on data it did not train on',
'Data checks and three-way split':'Check the data, then split it',
'Check schema, target values, missingness and duplicates\\nAssert split isolation and exclude leaky inputs':'Check columns, labels, missing values and repeated rows\\nKeep the groups separate. Remove fields that reveal the answer.',
'Learn preprocessing\\nand model parameters':'Teach the model\\nusing these rows',
'Choose model\\nand decision threshold':'Choose the model\\nand alert cutoff',
'Evaluate the\\nfrozen decision':'Check the final model\\nwithout changing it',
'Stratified 60 / 20 / 20 split, seed 42':'60% / 20% / 20% split. Keep a similar share of failures in each group.',
'1   Fit preprocessing and candidates on training rows\\n2   Compare validation scores and the overfitting gap\\n3   Select the threshold using validation error costs\\n4   Freeze the pipeline and threshold, then test once':'1   Train the models using the training data\\n2   Compare their results on the validation data\\n3   Choose an alert cutoff based on misses and false alarms\\n4   Keep these choices fixed and check the test data once',
'Saved decision: failure score ≥ 0.13\\nExport the entire pipeline plus schema, threshold and versions':'Raise an alert when the model score is 0.13 or higher\\nSave the data preparation, model and prediction settings',
'Evaluation metrics':'How well did the model do?',
'Accuracy alone hides the cost of rare failures':'A high accuracy score can still hide missed failures',
'Inference using Kafka':'Making predictions with Kafka',
'Test-row replay':'Sends test rows',
'Saved pipeline':'Runs the saved model',
'Output: failure score, decision, actual label and running metrics\\nOnly features enter the model. Labels serve demo scoring.':'See the model score, prediction, known answer and results so far\\nThe model sees the readings. We use the known answer to check it.'
}
for a,b in changes.items():
 if a not in s: print('Missing',a)
 s=s.replace(a,b)
# Accommodate longer plain-language diagram labels.
s=s.replace("'Learn data preparation',700,190","'Learn how to\\nprepare data',700,190")
Path('.kt-deck-build/simple.mjs').write_text(s)
p=Path('.kt-deck-build/finish-revision.mjs');s=p.read_text().replace("'./revise.mjs'","'./simple.mjs'")
changes={
'Agentic application with the model':'An AI assistant that uses the model',
'Proposed architecture: tool calling inside the harness':'Proposed design: the assistant calls a prediction tool',
'User request\\n+ observation':'User question\\n+ machine readings',
'LLM orchestrator\\nRegistered tool schema':'AI assistant (LLM)\\nKnows the available tool',
'Inference tool\\nPipeline + metadata':'Prediction tool\\nSaved model + settings',
'Execution DAG for one assessment':'Steps for one request (DAG)',
'Plan tool call':'Choose the tool',
'Validate + infer':'Check inputs + predict',
'Invalid / failed:\\nclarify or report error':'If something is wrong:\\nask for details or show error',
'Response +\\nraw ML output':'Plain-language answer +\\noriginal model result',
'Raw result passes through unchanged: p_failure, prediction, threshold, notices':'Keep the original model result: score, prediction, cutoff and warnings',
'revised-candidate.pptx':'simple-candidate.pptx',
'AI4I-KT-10-slides-final.pptx':'AI4I-KT-simple.pptx',
'revised-final-validation.json':'simple-validation.json',
"'/.kt-deck-build/revised-'":"'/.kt-deck-build/simple-'"
}
for a,b in changes.items(): s=s.replace(a,b)
notes=[
'We will use the notebook to understand the data and train a model. Then we will switch to Kafka to see predictions arrive as messages. Finally, we will look at how an AI assistant could call the same model. Allow about 40 minutes for the notebook, 12 for Kafka and 8 for the assistant design.',
'Show notebook sections 3–11. Start with the raw data and check it. Split it before learning how to fill missing values or encode categories. Train a few models. Use validation data to choose the model and alert cutoff. Use test data only after those choices are fixed. Save the full set of steps, called a pipeline, so new readings get the same treatment. Source: src/reference.ipynb.',
'Show a few rows in notebook sections 2–4. Each row contains machine readings and a label saying whether it shows a failure. There are 10,000 rows and 339 failures. Both AI4I and our added fields are simulated teaching data. We are checking the current state, not predicting a failure minutes into the future. Sources: data/ai4i2020.csv; data/processed/ai4i_plus.csv. Original dataset: UCI AI4I 2020, DOI 10.24432/C5HS5C, CC BY 4.0.',
'A feature is an input the model uses. We keep six numeric readings and one category, product type. Air and process temperatures use kelvin. Torque describes twisting force. Tool wear is measured in minutes. Vibration RMS summarizes vibration strength and is simulated here. Leave out the answer and anything recorded after a failure. IDs and unused extra fields stay out too. Ask: would we know this value when making a prediction? We have few inputs, so there is no need to compress them using PCA. Sources: src/reference.ipynb section 5; artifacts/machine_failure_metadata.json.',
'The dummy model always says normal. It shows why accuracy can look good when failures are rare. The small tree uses a short set of rules we can explain. Random Forest combines many trees and can find patterns involving several readings together. Compare results on training and validation rows. If training results are much better, the model may be memorizing details that do not carry over. The deep tree in the notebook demonstrates this. Source: src/reference.ipynb section 7.',
'Check that the expected columns exist, labels make sense, numbers are valid, and missing or repeated rows are understood. These are checks to discuss; the notebook does not have an assertion for every item. Split into 6,000 training rows, 2,000 validation rows and 2,000 test rows. Check that no row appears in more than one group. Stratification means keeping a similar share of failures in each group. Seed 42 makes this random split repeatable. Learn data-preparation settings only from training rows. Source: src/reference.ipynb sections 4–6 and 13.',
'Show notebook sections 6–10. Fill missing numbers with the middle training value, called the median. Fill missing categories with the most common training category, then turn categories into numeric inputs. Train each model and compare validation results. For this example, assume a missed failure costs 10 units and a false alarm costs 1. These are teaching assumptions. They lead to the saved cutoff of 0.13. Keep the model and cutoff fixed when checking the test rows. Save the preparation steps, model, input list, cutoff and package versions. Sources: src/reference.ipynb; artifacts/machine_failure_metadata.json.',
'Recall asks: how many real failures did we catch? We caught 60 out of 68, or 88.2%. Precision asks: how many alerts were correct? 60 out of 190, or 31.6%. We missed 8 failures and raised 130 false alarms. Accuracy is the share of all predictions that were correct. F1 combines precision and recall in one score. Average precision and ROC-AUC summarize how well scores separate failures from normal rows across different cutoffs. Average precision is not the same calculation as area under the precision-recall curve. These are the saved test results. Always saying normal would give 96.6% accuracy but catch no failures. Sources: artifacts/machine_failure_metadata.json; local/STREAMING.md.',
'Switch to the terminals. Start Kafka and create the topic using local/STREAMING.md if needed. Use the Python environment that matches the saved model. The producer sends test rows. Kafka carries them. The consumer runs the saved model and prints the result. The model uses only machine readings. The known answer is included separately so the demo can check predictions. Repeating these rows does not give new evidence about model quality. Missing sensor values are filled and flagged. Invalid values are skipped. Real machines usually need a later confirmed outcome before we can check a prediction. Sources: src/producer.py; src/consumer.py; local/STREAMING.md.',
'This is a proposed application. The user supplies a question and machine readings. The AI assistant knows the prediction tool and the inputs it needs. It chooses that tool. The app checks the inputs and runs the saved model with its settings. The tool returns the score, prediction, cutoff and any warnings. The assistant uses that result to explain the answer. The app also includes the original tool output unchanged. The assistant must not invent readings or change the prediction. If the input or tool fails, ask for details or show an error. DAG means directed acyclic graph: the steps and arrows show one request moving forward without a loop. Kafka is used in the earlier demo; this direct tool call does not need Kafka.'
]
import json
insert='const simpleNotes = '+json.dumps(notes)+';\np.slides.items.forEach((slide,i)=>slide.speakerNotes.textFrame.setText(simpleNotes[i]));\n'
s=s.replace('await (await PresentationFile.exportPptx(p))',insert+'await (await PresentationFile.exportPptx(p))')
Path('.kt-deck-build/finish-simple.mjs').write_text(s)
