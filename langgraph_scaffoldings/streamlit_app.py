import streamlit as st
from rag_chat import rag_response
from vector_store_operations import ensure_vectorstore, retrieve_context, vectorize_docs

st.title("Streamlit App")
session = st.session_state
session["vs_collections_name"] = "temporary_from_streamlit_app"

uploaded_files = st.file_uploader(
    label="Select file to upload",
    type=["txt", "pdf"],
    accept_multiple_files=True,
)
prompt = st.text_input(label="Enter your prompt",
                        value="What is the name of the react project?")
if st.button("Upload file"):
    pass
    #st.info("Vectorizing docs:", ",".join(uploaded_files))
    # with st.spinner("Processing..", show_time=True):
    #     vectorized, e = vectorize_docs(uploaded_files, collection_name=session["vs_collections_name"])

    # if vectorized:
    #     st.info("File processed.")
    # else:
    #     st.error("Unable to process documents")
    #     st.error(e)

    with st.spinner("Processing", show_time=True):
        #st.info("Gotfiles: " + str(uploaded_files[0]))
        st.info(type(uploaded_files[0]))
        st.info("Filename: " + uploaded_files[0].name)
        st.info(rag_response(prompt, collection_name=session["vs_collections_name"]), uploaded_files[0])

                       #value="What does the chapter 3 mainly focuses on in the multi agent systems document?")
# if st.button("Send", type="secondary"):
#     with st.spinner("Processing", show_time=True):
#         st.info(rag_response(prompt, collection_name=session["vs_collections_name"]), uploaded_files)

