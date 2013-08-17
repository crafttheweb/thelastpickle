# Re-using question_2 consensus object

# Session 1, Player 1
# This player lost the first time. 
# It loses the second call as well.

In [29]: player_1 = assign23.Consensus2("question_2")
In [30]: player_1.decide(0, "Down")
Out[30]: (False, u'Up')

# Session 2, Player 2
# This play won the first time. 
# It loses the second call though

In [32]: player_2 = assign23.Consensus2("question_2")
In [33]: player_2.decide(1, "Up")
Out[33]: (False, u'Down')

# Hmm, back to player 1
In [32]: player_1.decide(0, "Down")
Out[32]: (False, u'Up')

# output from cqlsh 
cqlsh:dev> select * from cf23;
 name       | element_0 | element_1 | element_2 | propose_0 | propose_1
------------+-----------+-----------+-----------+-----------+-----------
 question_1 |         0 |         1 |         1 |       Red |     Black
 question_2 |         0 |         0 |         1 |      Down |        Up

# Double Hmm, player 2?
In [34]: player_2.decide(1, "Up")
Out[34]: (False, u'Down')

# output from cqlsh
cqlsh:dev> select * from cf23;
 name       | element_0 | element_1 | element_2 | propose_0 | propose_1
------------+-----------+-----------+-----------+-----------+-----------
 question_1 |         0 |         1 |         1 |       Red |     Black
 question_2 |         0 |         1 |         1 |      Down |        Up
