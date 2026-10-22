"""Exercise Jupiter Flashloan through a local CPI pass-through on Surfpool."""
import base64,json,os
from pathlib import Path
from urllib.request import Request,urlopen
from solders.hash import Hash
from solders.instruction import AccountMeta,Instruction
from solders.message import Message
from solders.pubkey import Pubkey
from solders.transaction import Transaction

LIVE=os.environ["SOLANA_RPC"];LOCAL="http://127.0.0.1:18999"
PROGRAM=Pubkey.from_string("jupgfSgfuAXv4B6R2Uxu85Z1qdzgju79s6MfZekN6XS")
CALLER=Pubkey.from_string("3dUgRbXPp2NRiVLWry77hWTULfkUdYEQGELYNDJgh3X6")
SIG="4G9tPDpx1dcPpeZpb2MG5DyFLnZMuaUZgSpuSnXnXvrJDdUc4H5KeXfFG7XDbvjbhhZdDCctHof382JMUUStdWhp"
IDL=Path("/Users/stacc/Documents/Codex/2026-10-15/goonfi-daybreak-audit/work/jupiter-lend-current/public/idl/flashloan.json")
ABC="123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz"
def rpc(url,method,params):
 req=Request(url,data=json.dumps({"jsonrpc":"2.0","id":1,"method":method,"params":params}).encode(),headers={"content-type":"application/json"})
 with urlopen(req,timeout=120) as r:return json.load(r)
def b58(v):
 n=0
 for c in v:n=n*58+ABC.index(c)
 return b"\0"*(len(v)-len(v.lstrip("1")))+n.to_bytes((n.bit_length()+7)//8,"big")
specs={i["name"]:i for i in json.loads(IDL.read_text())["instructions"]}
tx=rpc(LIVE,"getTransaction",[SIG,{"encoding":"jsonParsed","commitment":"finalized","maxSupportedTransactionVersion":1}])["result"]
borrow0,payback0=[i for i in tx["transaction"]["message"]["instructions"] if i.get("programId")==str(PROGRAM)]
payer=Pubkey.from_string(tx["transaction"]["message"]["accountKeys"][0]["pubkey"])
def direct(source,name):
 return Instruction(PROGRAM,b58(source["data"]),[AccountMeta(Pubkey.from_string(a),bool(s.get("signer")),bool(s.get("writable"))) for a,s in zip(source["accounts"],specs[name]["accounts"])])
borrow=direct(borrow0,"flashloan_borrow");payback=direct(payback0,"flashloan_payback")
wrapper_borrow=Instruction(CALLER,b58(borrow0["data"]),[AccountMeta(PROGRAM,False,False)]+list(borrow.accounts))
wrapper_payback=Instruction(CALLER,b58(payback0["data"]),[AccountMeta(PROGRAM,False,False)]+list(payback.accounts))
cases={"local_direct_control":[borrow,payback],"cpi_borrow_with_direct_payback":[wrapper_borrow,payback],"cpi_borrow_only":[wrapper_borrow],"cpi_payback_only":[wrapper_payback]}
results=[]
for name,ixs in cases.items():
 blockhash=Hash.from_string(rpc(LOCAL,"getLatestBlockhash",[{"commitment":"processed"}])["result"]["value"]["blockhash"]);wire=base64.b64encode(bytes(Transaction.new_unsigned(Message.new_with_blockhash(ixs,payer,blockhash)))).decode();response=rpc(LOCAL,"simulateTransaction",[wire,{"encoding":"base64","sigVerify":False}]);value=response.get("result",{}).get("value")
 results.append({"case":name,"err":value.get("err") if value else None,"unitsConsumed":value.get("unitsConsumed") if value else None,"logs":value.get("logs") if value else None,"rpcError":response.get("error")})
print(json.dumps({"flashloanProgram":str(PROGRAM),"localCallerProgram":str(CALLER),"sourceSignature":SIG,"sourceSlot":tx["slot"],"fork":"Surfpool mainnet fork; caller deployed locally only","liveSubmission":False,"results":results},indent=2))
