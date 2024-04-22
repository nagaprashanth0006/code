import os
from openai import AzureOpenAI

"""
setx AZURE_OPENAI_API_KEY "REPLACE_WITH_YOUR_KEY_VALUE_HERE"
setx AZURE_OPENAI_ENDPOINT "REPLACE_WITH_YOUR_ENDPOINT_HERE"
"""


endpoint = os.getenv("AZURE_OPENAI_ENDPOINT")
region = "eastus"
key = os.getenv("AZURE_OPENAI_API_KEY")
print(endpoint, key)

client = AzureOpenAI(
    azure_endpoint= endpoint,
    api_key=key,
    api_version="2024-02-01"
)

response = client.chat.completions.create(

    model = "azopenaiOGAIC",
    messages = [
        {
            "role": "system",
            "content": "You're a helpful assistant."
        },
        {
            "role": "user",
            "content": "Does Azure OpenAI support customer managed keys?"
        },
        {
            "role": "assistant",
            "content": "Yes, customer managed keys are supported by Azure OpenAI"
        },
        {
            "role": "user",
            "content": "Do other Azure AI services support this too?"
        },
        {
            "role": "user",
            "content": "What are all your capabilities and explain the real-time applications for your model"
        },
    ]
)
print(response.choices[0].message.content)
