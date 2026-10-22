"""Read-only cardinality/order tests for deployed Jupiter Flashloan."""
import base64, json, os
from pathlib import Path
from urllib.request import Request, urlopen
from solders.hash import Hash
from solders.instruction import AccountMeta, Instruction
from solders.message import Message
from solders.pubkey import Pubkey
from solders.transaction import Transaction

RPC=os.environ["SOLANA_RPC"]
PROGRAM=Pubkey.from_string("jupgfSgfuAXv4B6R2Uxu85Z1qdzgju79s6MfZekN6XS")
SIG="4G9tPDpx1dcPpeZpb2MG5DyFLnZMuaUZgSpuSnXnXvrJDdUc4H5KeXfFG7XDbvjbhhZdDCctHof382JMUUStdWhp"
IDL=Path("/Users/stacc/Documents/Codex/2026-10-15/goonfi-daybreak-audit/work/jupiter-lend-current/public/idl/flashloan.json")
ABC="123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz"

def rpc(method,params):
 req=Request(RPC,data=json.dumps({"jsonrpc":"2.0","id":1,"method":method,"params":params}).encode(),headers={"content-type":"application/json"})
 with urlopen(req,timeout=90) as r:return json.load(r)
def b58(v):
 n=0
 for c in v:n=n*58+ABC.index(c)
 return b"\0"*(len(v)-len(v.lstrip("1")))+n.to_bytes((n.bit_length()+7)//8,"big")

specs={i["name"]:i for i in json.loads(IDL.read_text())["instructions"]}
tx=rpc("getTransaction",[SIG,{"encoding":"jsonParsed","commitment":"finalized","maxSupportedTransactionVersion":1}])["result"]
src=[i for i in tx["transaction"]["message"]["instructions"] if i.get("programId")==str(PROGRAM)]
borrow0,payback0=src
payer=Pubkey.from_string(tx["transaction"]["message"]["accountKeys"][0]["pubkey"])
def make(ix,name,amount=None):
 raw=bytearray(b58(ix["data"]));
 if amount is not None:raw[8:16]=amount.to_bytes(8,"little")
 metas=[AccountMeta(Pubkey.from_string(a),bool(s.get("signer")),bool(s.get("writable"))) for a,s in zip(ix["accounts"],specs[name]["accounts"])]
 return Instruction(PROGRAM,bytes(raw),metas)
amount=int.from_bytes(b58(borrow0["data"])[8:16],"little")
borrow,payback=make(borrow0,"flashloan_borrow"),make(payback0,"flashloan_payback")
amount_b=amount-1
borrow_b,payback_b=make(borrow0,"flashloan_borrow",amount_b),make(payback0,"flashloan_payback",amount_b)
cases={
 "control_borrow_payback":[borrow,payback],
 "duplicate_borrow_single_payback":[borrow,borrow,payback],
 "triple_borrow_single_payback":[borrow,borrow,borrow,payback],
 "borrow_payback_borrow":[borrow,payback,borrow],
 "payback_before_borrow":[payback,borrow],
 "two_amounts_two_paybacks":[borrow,borrow_b,payback,payback_b],
 "two_amounts_only_first_payback":[borrow,borrow_b,payback],
 "two_amounts_only_second_payback":[borrow,borrow_b,payback_b],
}
results=[]
for name,ixs in cases.items():
 wire=base64.b64encode(bytes(Transaction.new_unsigned(Message.new_with_blockhash(ixs,payer,Hash.default())))).decode()
 response=rpc("simulateTransaction",[wire,{"encoding":"base64","sigVerify":False,"replaceRecentBlockhash":True,"innerInstructions":True}])
 value=response.get("result",{}).get("value")
 results.append({"case":name,"instructionCount":len(ixs),"err":value.get("err") if value else None,"unitsConsumed":value.get("unitsConsumed") if value else None,"logs":value.get("logs") if value else None,"rpcError":response.get("error")})
print(json.dumps({"program":str(PROGRAM),"sourceSignature":SIG,"sourceSlot":tx["slot"],"sourceAmount":amount,"secondaryAmount":amount_b,"transport":"mainnet simulateTransaction only; no sendTransaction","results":results},indent=2))
