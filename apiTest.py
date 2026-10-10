# AI model => Apodex: Apodex 1.1 Mini (free)

from dotenv import load_dotenv
import requests
import json
import os


load_dotenv()



PROMPT = '''
            You are an expert data visualization engineer and statistician.
            
            Your task is to analyze the provided CSV data (or its column structure/sample rows if the full dataset is too large)
            and recommend the single best chart, graph, or diagram type to visualize it.

            Please follow these constraints:
                1. Base your recommendation on the data types, distribution, and the analytical relationship between the variables
                   (e.g., time-series, categorical comparison, correlation, distribution, composition).
                2. Provide your output strictly in the following format, with no extra conversational filler,
                   markdown code blocks outside of the structure, or preamble:

                        {
                            "answer": "[Name of the best chart/graph/diagram type]",
                            "reasoning": "[One or two concise sentences explaining why this visualization suits the data structure and
                                           analytical goal]"
                        }
         '''.strip()



if __name__ == '__main__':

    with open("samples/chickweight.csv") as f:
        data = f.read()

    response = requests.post(
            url     = "https://openrouter.ai/api/v1/chat/completions",
            headers = {
                "Authorization" : f"Bearer {os.getenv("OPENROUTER_API_KEY")}",
                "Content-type"  : "application/json",
            },
            data    = json.dumps(
                {
                    "model"    : "apodex/apodex-1.1-mini:free",
                    "messages" : [
                        {
                            "role"    : "user",
                            "content" : PROMPT + data
                        },
                    ],
                    "reasoning" : {
                        "enabled" : True
                    }
                }
            )
    )

    response = response.json()
    print(response)
