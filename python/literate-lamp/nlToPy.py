import os
from openai import AzureOpenAI

client = AzureOpenAI(
    api_key=os.getenv("AZURE_OPENAI_API_KEY"),
    api_version="2024-02-01",
    azure_endpoint="https://azopenaiogaic.openai.azure.com/"
)

# This will correspond to the custom name you chose for your deployment when you deployed a model.
# Use a gpt-35-turbo-instruct deployment.
deployment_name = "azopenaiOGAIC"

# Send a completion call to generate an answer
prompt = ("# Write a python function to reverse a string. The function should be an optimal solution in terms of" +
          " time and space complexity.\n# Example input to the function: abcd123\n" +
          "# Example output to the function: 321dcba")

#prompt = ("# Write a python program to print 0 if input is 1 and print 1 if input is 0" +
#          "\n# Do not use conditional or bitwise operators. # Example input 0. # Example output 1")

response = client.completions.create(
    model=deployment_name,
    prompt=prompt,
    temperature=0.9,
    max_tokens=200,
    top_p=1,
    frequency_penalty=0,
    presence_penalty=0,
    stop=["#"]
)

result = response.choices[0].text
print(prompt + result)
