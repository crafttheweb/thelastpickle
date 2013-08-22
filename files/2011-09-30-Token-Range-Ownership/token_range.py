#!/usr/bin/env python
"""Script to output the token range ownership for Cassandra nodes. 

usage:
$ ./token_range.py --interactive 154009024815050802110273337963779530663 141704132449535340642001248672108470009 102889564695022956386161396156024583904
154009024815050802110273337963779530663 141704132449535340642001248672108470009 102889564695022956386161396156024583904
69.95% - 102889564695022956386161396156024583904
22.81% - 141704132449535340642001248672108470009
 7.23% - 154009024815050802110273337963779530663
 
"""
import argparse
import sys

def get_parser():
    parser = argparse.ArgumentParser(prog="Token Buddy", 
        description="In a world where tokens are unbalanced.")
        
    parser.add_argument("tokens", metavar="token", type=str, nargs="+",
        help="Space separated list of tokens.")
        
    parser.add_argument("--interactive", "-i", default=False, 
        action='store_true', help="Accept token list from prompt.")
    return parser 
    
def describe_ownership(tokens):

    if len(tokens) == 1:
        return zip([1], tokens)
        
    #order the tokens
    tokens.sort()

    # list of the tokens offset to the right 1
    # first item is the diff between the last token and the max token
    # is -ve because it will be subtracted from th first token
    max_token = 2 ** 127 #change this to 10 if you want to test things
    offset_tokens = [0-(max_token-tokens[-1])] + tokens[:-1]
    
    #diff between each token and it's previous
    deltas = [
        t - prev_t
        for t, prev_t in zip(tokens, offset_tokens)
    ]
    
    # from RP ownership is 
    # ((token - prev_token + max_token) % max_token) / max_token
    ownerships = [
        (((delta + max_token) % max_token) / (max_token * 1.0))
        for delta in deltas 
    ]
    
    return zip(ownerships, tokens)
    
def main():
    
    parser = get_parser()
    args = parser.parse_args()
    
    def gen_tokens():
        if args.tokens:
            yield args.tokens
        
        if args.interactive:
            line = "true"
            while line:
                try:
                    line = raw_input("Next tokens: ")
                except (EOFError, KeyboardInterrupt):
                    line = None
                if line:
                    yield line.split(" ")
        
                    
    for tokens in gen_tokens():
        tokens = [int(i) for i in tokens]
        print " ".join(str(i) for i in tokens)
        print "\n".join(
            "{0:>6.2%} - {1}".format(own, t)
            for own, t in describe_ownership(tokens)
        )
        print "\n"
    return
    
if __name__ == "__main__":
    sys.exit(main())
