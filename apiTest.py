# AI model => Apodex: Apodex 1.1 Mini (free)

import prompt

from http.server import (ThreadingHTTPServer, BaseHTTPRequestHandler)
from dotenv import load_dotenv
import requests
import json
import os


load_dotenv()






class CustomHandler(BaseHTTPRequestHandler):
    def do_POST(self):
        content_length = int(self.headers["content-length"]) 
        data = self.rfile.read(content_length)
        
        llm_response = LLM_request(data)
        
        self.send_response(200)

        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")

        self.end_headers()
        
        response_body = json.dumps(llm_response).encode("utf-8")
        
        self.wfile.write(response_body)


PORT = 8000
def start_server():
    httpd = ThreadingHTTPServer(('', PORT), CustomHandler)

    print(f"server started @ localhost:{PORT}")
   
    httpd.serve_forever()



def LLM_request(data):
    response = requests.post(
            url     = "https://openrouter.ai/api/v1/chat/completions",
            headers = {
                "Authorization" : f"Bearer {os.getenv("OPENROUTER_API_KEY")}",
                "Content-type"  : "application/json",
            },
            data    = json.dumps(
                {
                    "model"    : "dots-studio/dots-3-note-preview:free",
                    "messages" : [
                        {
                            "role"    : "user",
                            "content" : prompt.PROMPT + data.decode("utf-8")
                        },
                    ],
                    "reasoning" : {
                        "enabled" : True
                    }
                }
            )
    )

    response = response.json() 
    return response["choices"][0]["message"]["content"]


if __name__ == '__main__':
    start_server() 

