# written in networkx style
Creator "test"
graph [
  directed 1
  node [
    id 0
    label "Jos&#233; P&#233;rez"
    team "Design"
    tenure 3
    score 0.5
    graphics [ x 1.0 y 2.0 ]
  ]
  node [
    id 1
    label "Jordan"
    tenure 5
  ]
  node [
    id 2
    label "Sam"
  ]
  edge [
    source 0
    target 1
    weight 4.0
    channel "&#35;launch"
  ]
  edge [
    source 1
    target 2
    weight 1.5e1
  ]
  edge [ source 2 target 0 ]
]
